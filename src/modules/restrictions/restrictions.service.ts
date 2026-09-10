import { GroupStatus, Prisma } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import { decryptData } from '../../lib/data-protection.js';
import { prisma } from '../../lib/prisma.js';
import type {
  CreateBilateralRestrictionInput,
  CreateRestrictionInput,
} from './restrictions.schemas.js';

const ownedGroupSelect = {
  id: true,
  status: true,
} satisfies Prisma.GroupSelect;

const createdRestrictionSelect = {
  id: true,
  giverParticipantId: true,
  forbiddenParticipantId: true,
  createdAt: true,
} satisfies Prisma.RestrictionSelect;

const listedRestrictionSelect = {
  id: true,
  createdAt: true,
  giverParticipant: {
    select: {
      id: true,
      nameEncrypted: true,
    },
  },
  forbiddenParticipant: {
    select: {
      id: true,
      nameEncrypted: true,
    },
  },
} satisfies Prisma.RestrictionSelect;

type ListedRestriction = Prisma.RestrictionGetPayload<{
  select: typeof listedRestrictionSelect;
}>;

type PrismaClient = Prisma.TransactionClient | typeof prisma;

const getOwnedGroup = async (
  client: PrismaClient,
  groupId: string,
  ownerId: string,
) => {
  const group = await client.group.findFirst({
    where: { id: groupId, ownerId },
    select: ownedGroupSelect,
  });

  if (!group) {
    throw new AppError(404, 'Grupo não encontrado.');
  }

  return group;
};

const ensureDraft = (status: GroupStatus): void => {
  if (status !== GroupStatus.DRAFT) {
    throw new AppError(409, 'Este grupo só pode ser alterado enquanto estiver em rascunho.');
  }
};

const ensureDifferentParticipants = (
  giverParticipantId: string,
  forbiddenParticipantId: string,
): void => {
  if (giverParticipantId === forbiddenParticipantId) {
    throw new AppError(400, 'Um participante não pode ter restrição consigo mesmo.');
  }
};

const ensureGroupParticipants = async (
  client: PrismaClient,
  groupId: string,
  participantIds: [string, string],
): Promise<void> => {
  const participants = await client.participant.findMany({
    where: {
      groupId,
      id: { in: participantIds },
    },
    select: { id: true },
  });

  if (participants.length !== 2) {
    throw new AppError(404, 'Participante não encontrado.');
  }
};

const restrictionAlreadyExists = async (
  client: PrismaClient,
  groupId: string,
  giverParticipantId: string,
  forbiddenParticipantId: string,
) =>
  client.restriction.findFirst({
    where: { groupId, giverParticipantId, forbiddenParticipantId },
    select: { id: true },
  });

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const toListedRestriction = (restriction: ListedRestriction) => ({
  id: restriction.id,
  giver: {
    id: restriction.giverParticipant.id,
    name: decryptData(restriction.giverParticipant.nameEncrypted),
  },
  forbidden: {
    id: restriction.forbiddenParticipant.id,
    name: decryptData(restriction.forbiddenParticipant.nameEncrypted),
  },
  createdAt: restriction.createdAt,
});

export const createRestriction = async (
  groupId: string,
  ownerId: string,
  { giverParticipantId, forbiddenParticipantId }: CreateRestrictionInput,
) => {
  const group = await getOwnedGroup(prisma, groupId, ownerId);
  ensureDraft(group.status);
  ensureDifferentParticipants(giverParticipantId, forbiddenParticipantId);
  await ensureGroupParticipants(prisma, group.id, [
    giverParticipantId,
    forbiddenParticipantId,
  ]);

  if (
    await restrictionAlreadyExists(
      prisma,
      group.id,
      giverParticipantId,
      forbiddenParticipantId,
    )
  ) {
    throw new AppError(409, 'A restrição já existe.');
  }

  try {
    return await prisma.restriction.create({
      data: { groupId: group.id, giverParticipantId, forbiddenParticipantId },
      select: createdRestrictionSelect,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError(409, 'A restrição já existe.');
    }

    throw error;
  }
};

export const createBilateralRestriction = async (
  groupId: string,
  ownerId: string,
  { participantAId, participantBId }: CreateBilateralRestrictionInput,
) => {
  ensureDifferentParticipants(participantAId, participantBId);

  try {
    return await prisma.$transaction(async (transaction) => {
      const group = await getOwnedGroup(transaction, groupId, ownerId);
      ensureDraft(group.status);
      await ensureGroupParticipants(transaction, group.id, [
        participantAId,
        participantBId,
      ]);

      const [firstRestriction, secondRestriction] = await Promise.all([
        restrictionAlreadyExists(
          transaction,
          group.id,
          participantAId,
          participantBId,
        ),
        restrictionAlreadyExists(
          transaction,
          group.id,
          participantBId,
          participantAId,
        ),
      ]);

      // Bilateral requests are strict: an existing direction rejects the whole operation.
      if (firstRestriction || secondRestriction) {
        throw new AppError(409, 'Uma restrição bilateral já existe.');
      }

      return Promise.all([
        transaction.restriction.create({
          data: {
            groupId: group.id,
            giverParticipantId: participantAId,
            forbiddenParticipantId: participantBId,
          },
          select: createdRestrictionSelect,
        }),
        transaction.restriction.create({
          data: {
            groupId: group.id,
            giverParticipantId: participantBId,
            forbiddenParticipantId: participantAId,
          },
          select: createdRestrictionSelect,
        }),
      ]);
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError(409, 'Uma restrição bilateral já existe.');
    }

    throw error;
  }
};

export const listRestrictions = async (groupId: string, ownerId: string) => {
  const group = await getOwnedGroup(prisma, groupId, ownerId);
  const restrictions = await prisma.restriction.findMany({
    where: { groupId: group.id },
    orderBy: { createdAt: 'asc' },
    select: listedRestrictionSelect,
  });

  return restrictions.map(toListedRestriction);
};

export const deleteRestriction = async (
  groupId: string,
  restrictionId: string,
  ownerId: string,
): Promise<void> => {
  const group = await getOwnedGroup(prisma, groupId, ownerId);
  ensureDraft(group.status);
  const restriction = await prisma.restriction.findFirst({
    where: { id: restrictionId, groupId: group.id },
    select: { id: true },
  });

  if (!restriction) {
    throw new AppError(404, 'Restrição não encontrada.');
  }

  await prisma.restriction.delete({ where: { id: restriction.id } });
};
