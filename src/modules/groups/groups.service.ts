import { GroupStatus, Prisma } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import {
  createEmailLookupHash,
  decryptData,
} from '../../lib/data-protection.js';
import { prisma } from '../../lib/prisma.js';
import type { CreateGroupInput, UpdateGroupInput } from './groups.schemas.js';

const groupListSelect = {
  id: true,
  name: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GroupSelect;

const createdGroupSelect = {
  id: true,
  name: true,
  status: true,
  createdAt: true,
} satisfies Prisma.GroupSelect;

const getOwnedGroup = async (groupId: string, ownerId: string) => {
  const group = await prisma.group.findFirst({
    where: { id: groupId, ownerId },
    select: groupListSelect,
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

export const createGroup = async (
  ownerId: string,
  { name }: CreateGroupInput,
) =>
  prisma.group.create({
    data: {
      ownerId,
      name,
      status: GroupStatus.DRAFT,
    },
    select: createdGroupSelect,
  });

const accessibleGroupSelect = (userId: string) =>
  ({
    ...groupListSelect,
    ownerId: true,
    participants: {
      where: { userId },
      take: 1,
      select: {
        id: true,
        nameEncrypted: true,
        accesses: {
          where: { revealedAt: { not: null } },
          take: 1,
          select: { id: true },
        },
      },
    },
  }) satisfies Prisma.GroupSelect;

const toAccessibleGroup = <
  T extends {
    id: string;
    name: string;
    status: GroupStatus;
    createdAt: Date;
    updatedAt: Date;
    ownerId: string;
    participants: Array<{
      id: string;
      nameEncrypted: string;
      accesses: Array<{ id: string }>;
    }>;
  },
>(group: T, userId: string) => {
  const participant = group.participants[0];

  return {
    id: group.id,
    name: group.name,
    status: group.status,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    roles: [
      ...(group.ownerId === userId ? (['OWNER'] as const) : []),
      ...(participant ? (['PARTICIPANT'] as const) : []),
    ],
    participant: participant
      ? {
          id: participant.id,
          name: decryptData(participant.nameEncrypted),
          revealed: participant.accesses.length > 0,
        }
      : null,
  };
};

export const listGroups = async (userId: string) => {
  const groups = await prisma.group.findMany({
    where: {
      OR: [{ ownerId: userId }, { participants: { some: { userId } } }],
    },
    orderBy: { createdAt: 'desc' },
    select: accessibleGroupSelect(userId),
  });

  return groups.map((group) => toAccessibleGroup(group, userId));
};

export const syncOwnerParticipations = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (!user) {
    throw new AppError(401, 'Não autorizado.');
  }

  const result = await prisma.participant.updateMany({
    where: {
      userId: null,
      emailLookupHash: createEmailLookupHash(user.email),
      group: {
        ownerId: userId,
        participants: { none: { userId } },
      },
    },
    data: { userId },
  });

  return { linked: result.count };
};

export const getGroup = async (groupId: string, userId: string) => {
  const group = await prisma.group.findFirst({
    where: {
      id: groupId,
      OR: [{ ownerId: userId }, { participants: { some: { userId } } }],
    },
    select: accessibleGroupSelect(userId),
  });

  if (!group) {
    throw new AppError(404, 'Grupo não encontrado.');
  }

  return toAccessibleGroup(group, userId);
};

export const renameGroup = async (
  groupId: string,
  ownerId: string,
  { name }: UpdateGroupInput,
) => {
  const group = await getOwnedGroup(groupId, ownerId);
  ensureDraft(group.status);

  return prisma.group.update({
    where: { id: group.id },
    data: { name },
    select: groupListSelect,
  });
};

export const deleteGroup = async (
  groupId: string,
  ownerId: string,
): Promise<void> => {
  const group = await getOwnedGroup(groupId, ownerId);
  ensureDraft(group.status);

  await prisma.group.delete({ where: { id: group.id } });
};
