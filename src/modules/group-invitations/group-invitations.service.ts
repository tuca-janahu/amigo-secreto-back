import { GroupStatus, Prisma } from '@prisma/client';

import { config } from '../../config/env.js';
import { AppError } from '../../lib/app-error.js';
import {
  createEmailLookupHash,
  decryptData,
  encryptData,
  normalizeEmail,
} from '../../lib/data-protection.js';
import { prisma } from '../../lib/prisma.js';
import {
  generateGroupInvitationToken,
  hashGroupInvitationToken,
} from './group-invitations.tokens.js';

const invitationSelect = {
  tokenEncrypted: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GroupInvitationSelect;

export const invitationNotFoundError = (): AppError =>
  new AppError(404, 'Convite não encontrado.', 'INVITATION_NOT_FOUND');

const invitationClosedError = (): AppError =>
  new AppError(
    409,
    'As inscrições para este grupo estão encerradas.',
    'INVITATION_CLOSED',
  );

const participationConflictError = (): AppError =>
  new AppError(
    409,
    'Esta participação já está vinculada a outra conta.',
    'PARTICIPATION_ALREADY_CLAIMED',
  );

const ensureDraft = (status: GroupStatus): void => {
  if (status !== GroupStatus.DRAFT) throw invitationClosedError();
};

const getOwnedDraftGroup = async (
  transaction: Prisma.TransactionClient,
  groupId: string,
  ownerId: string,
) => {
  const group = await transaction.group.findFirst({
    where: { id: groupId, ownerId },
    select: { id: true, status: true },
  });
  if (!group) throw new AppError(404, 'Grupo não encontrado.');
  ensureDraft(group.status);
  return group;
};

// An UPDATE locks the group until commit without raw SQL. Every invitation write
// acquires this lock before re-reading the invitation or participants.
const lockDraftGroup = async (
  transaction: Prisma.TransactionClient,
  groupId: string,
) => {
  const locked = await transaction.group.updateMany({
    where: { id: groupId, status: GroupStatus.DRAFT },
    data: { updatedAt: new Date() },
  });
  if (locked.count !== 1) throw invitationClosedError();
};

const toPublicInvitation = (
  invitation: Prisma.GroupInvitationGetPayload<{
    select: typeof invitationSelect;
  }>,
) => ({
  url: new URL(
    `/invite/${decryptData(invitation.tokenEncrypted)}`,
    config.appUrl,
  ).toString(),
  createdAt: invitation.createdAt,
  updatedAt: invitation.updatedAt,
});

const transactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
};

export const getGroupInvitation = async (groupId: string, ownerId: string) =>
  prisma.$transaction(async (transaction) => {
    await getOwnedDraftGroup(transaction, groupId, ownerId);
    const invitation = await transaction.groupInvitation.findUnique({
      where: { groupId },
      select: invitationSelect,
    });
    return invitation ? toPublicInvitation(invitation) : null;
  }, transactionOptions);

export const replaceGroupInvitation = async (
  groupId: string,
  ownerId: string,
) =>
  prisma.$transaction(async (transaction) => {
    await getOwnedDraftGroup(transaction, groupId, ownerId);
    await lockDraftGroup(transaction, groupId);
    const token = generateGroupInvitationToken();
    const data = {
      tokenHash: hashGroupInvitationToken(token),
      tokenEncrypted: encryptData(token),
    };
    const invitation = await transaction.groupInvitation.upsert({
      where: { groupId },
      create: { groupId, ...data },
      update: data,
      select: invitationSelect,
    });
    return toPublicInvitation(invitation);
  }, transactionOptions);

export const deleteGroupInvitation = async (
  groupId: string,
  ownerId: string,
): Promise<void> => {
  await prisma.$transaction(async (transaction) => {
    await getOwnedDraftGroup(transaction, groupId, ownerId);
    await lockDraftGroup(transaction, groupId);
    await transaction.groupInvitation.deleteMany({ where: { groupId } });
  }, transactionOptions);
};

export const previewGroupInvitation = async (token: string) => {
  const invitation = await prisma.groupInvitation.findUnique({
    where: { tokenHash: hashGroupInvitationToken(token) },
    select: { group: { select: { name: true, status: true } } },
  });
  if (!invitation) throw invitationNotFoundError();
  ensureDraft(invitation.group.status);
  return { group: { name: invitation.group.name } };
};

export const joinGroupInvitation = async (token: string, userId: string) => {
  try {
    return await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true },
      });
      if (!user) throw new AppError(401, 'Não autorizado.');

      const tokenHash = hashGroupInvitationToken(token);
      const invitation = await transaction.groupInvitation.findUnique({
        where: { tokenHash },
        select: { groupId: true },
      });
      if (!invitation) throw invitationNotFoundError();

      const { groupId } = invitation;
      await lockDraftGroup(transaction, groupId);
      // Rotation/revocation may have committed while we waited for the lock.
      const currentInvitation = await transaction.groupInvitation.findFirst({
        where: { groupId, tokenHash },
        select: { id: true },
      });
      if (!currentInvitation) throw invitationNotFoundError();

      const linkedParticipant = await transaction.participant.findUnique({
        where: { groupId_userId: { groupId, userId } },
        select: { id: true },
      });
      if (linkedParticipant)
        return { groupId, participantId: linkedParticipant.id };

      const email = normalizeEmail(user.email);
      const emailLookupHash = createEmailLookupHash(email);
      const existingParticipant = await transaction.participant.findUnique({
        where: { groupId_emailLookupHash: { groupId, emailLookupHash } },
        select: { id: true, userId: true },
      });
      if (existingParticipant) {
        if (existingParticipant.userId !== null)
          throw participationConflictError();
        const claimed = await transaction.participant.updateMany({
          where: {
            id: existingParticipant.id,
            groupId,
            emailLookupHash,
            userId: null,
          },
          data: { userId },
        });
        if (claimed.count !== 1) throw participationConflictError();
        return { groupId, participantId: existingParticipant.id };
      }

      const participant = await transaction.participant.create({
        data: {
          groupId,
          userId,
          nameEncrypted: encryptData(user.name),
          emailEncrypted: encryptData(email),
          emailLookupHash,
        },
        select: { id: true },
      });
      return { groupId, participantId: participant.id };
    }, transactionOptions);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw participationConflictError();
    }
    throw error;
  }
};
