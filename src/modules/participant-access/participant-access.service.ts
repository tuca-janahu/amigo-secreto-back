import { Prisma } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import {
  createEmailLookupHash,
  decryptData,
  decryptSorteioResult,
} from '../../lib/data-protection.js';
import { prisma } from '../../lib/prisma.js';
import { hashParticipantAccessToken } from './participant-access.tokens.js';

const participantAccessSelect = {
  id: true,
  participantId: true,
  expiresAt: true,
  revokedAt: true,
  firstAccessedAt: true,
  revealedAt: true,
  participant: {
    select: {
      nameEncrypted: true,
      emailLookupHash: true,
      userId: true,
      group: {
        select: {
          id: true,
          name: true,
          status: true,
        },
      },
      assignment: {
        select: {
          encryptedResult: true,
          iv: true,
          authTag: true,
        },
      },
    },
  },
} satisfies Prisma.ParticipantAccessSelect;

const invalidAccessError = (): AppError =>
  new AppError(404, 'Acesso do participante não encontrado.');

const getValidAccess = async (token: string) => {
  const access = await prisma.participantAccess.findUnique({
    where: { tokenHash: hashParticipantAccessToken(token) },
    select: participantAccessSelect,
  });

  if (
    !access ||
    access.revokedAt !== null ||
    (access.expiresAt !== null && access.expiresAt.getTime() <= Date.now())
  ) {
    throw invalidAccessError();
  }

  return access;
};

const registerFirstAccess = async (accessId: string): Promise<void> => {
  await prisma.participantAccess.updateMany({
    where: { id: accessId, firstAccessedAt: null },
    data: { firstAccessedAt: new Date() },
  });
};

const participationAlreadyClaimedError = (): AppError =>
  new AppError(409, 'Esta participação já está vinculada a outra conta.');

export const claimParticipantAccess = async (token: string, userId: string) => {
  const access = await getValidAccess(token);
  await registerFirstAccess(access.id);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (!user) {
    throw new AppError(401, 'Não autorizado.');
  }

  if (createEmailLookupHash(user.email) !== access.participant.emailLookupHash) {
    throw new AppError(403, 'Use uma conta com o mesmo e-mail do convite.');
  }

  if (access.participant.userId !== null && access.participant.userId !== userId) {
    throw participationAlreadyClaimedError();
  }

  if (access.participant.userId === null) {
    try {
      const claimed = await prisma.participant.updateMany({
        where: { id: access.participantId, userId: null },
        data: { userId },
      });

      if (claimed.count === 0) {
        const participant = await prisma.participant.findUnique({
          where: { id: access.participantId },
          select: { userId: true },
        });

        if (participant?.userId !== userId) {
          throw participationAlreadyClaimedError();
        }
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw participationAlreadyClaimedError();
      }

      throw error;
    }
  }

  return {
    groupId: access.participant.group.id,
    participantId: access.participantId,
  };
};

export const getParticipantAccessGroup = async (token: string) => {
  const access = await getValidAccess(token);
  await registerFirstAccess(access.id);

  return access.participant.group;
};

export const getParticipantAccess = async (token: string) => {
  const access = await getValidAccess(token);
  await registerFirstAccess(access.id);

  return {
    participant: {
      name: decryptData(access.participant.nameEncrypted),
    },
    group: {
      id: access.participant.group.id,
      name: access.participant.group.name,
    },
    revealed: access.revealedAt !== null,
  };
};

export const revealParticipantAccess = async (token: string) => {
  const access = await getValidAccess(token);
  const assignment = access.participant.assignment;

  if (!assignment) {
    throw invalidAccessError();
  }

  const { receiverParticipantId } = decryptSorteioResult(assignment);
  const receiver = await prisma.participant.findFirst({
    where: {
      id: receiverParticipantId,
      groupId: access.participant.group.id,
    },
    select: { nameEncrypted: true },
  });

  if (!receiver) {
    throw invalidAccessError();
  }

  await registerFirstAccess(access.id);

  const revealedAt = new Date();
  const revealUpdate = await prisma.participantAccess.updateMany({
    where: { id: access.id, revealedAt: null },
    data: { revealedAt },
  });

  if (revealUpdate.count === 0) {
    const revealedAccess = await prisma.participantAccess.findUnique({
      where: { id: access.id },
      select: { revealedAt: true },
    });

    if (!revealedAccess?.revealedAt) {
      throw invalidAccessError();
    }

    return {
      result: { name: decryptData(receiver.nameEncrypted) },
      revealedAt: revealedAccess.revealedAt,
    };
  }

  return {
    result: { name: decryptData(receiver.nameEncrypted) },
    revealedAt,
  };
};

export const revealLinkedParticipantAccess = async (
  groupId: string,
  userId: string,
) => {
  const participant = await prisma.participant.findFirst({
    where: { groupId, userId },
    select: {
      id: true,
      assignment: {
        select: {
          encryptedResult: true,
          iv: true,
          authTag: true,
        },
      },
      accesses: {
        where: { revealedAt: { not: null } },
        orderBy: { revealedAt: 'asc' },
        take: 1,
        select: { revealedAt: true },
      },
    },
  });

  if (!participant?.assignment) {
    throw new AppError(404, 'Grupo não encontrado.');
  }

  const { receiverParticipantId } = decryptSorteioResult(participant.assignment);
  const receiver = await prisma.participant.findFirst({
    where: { id: receiverParticipantId, groupId },
    select: { nameEncrypted: true },
  });

  if (!receiver) {
    throw new AppError(404, 'Grupo não encontrado.');
  }

  let revealedAt = participant.accesses[0]?.revealedAt ?? null;

  if (!revealedAt) {
    const firstRevealAt = new Date();
    const revealUpdate = await prisma.participantAccess.updateMany({
      where: { participantId: participant.id, revealedAt: null },
      data: { revealedAt: firstRevealAt },
    });

    if (revealUpdate.count > 0) {
      revealedAt = firstRevealAt;
    } else {
      const revealedAccess = await prisma.participantAccess.findFirst({
        where: { participantId: participant.id, revealedAt: { not: null } },
        orderBy: { revealedAt: 'asc' },
        select: { revealedAt: true },
      });
      revealedAt = revealedAccess?.revealedAt ?? null;
    }
  }

  if (!revealedAt) {
    throw new AppError(404, 'Grupo não encontrado.');
  }

  return {
    result: { name: decryptData(receiver.nameEncrypted) },
    revealedAt,
  };
};
