import { GroupStatus, Prisma } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
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
    throw new AppError(404, 'Group not found.');
  }

  return group;
};

const ensureDraft = (status: GroupStatus): void => {
  if (status !== GroupStatus.DRAFT) {
    throw new AppError(409, 'Group can only be changed while in DRAFT.');
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

export const listGroups = async (ownerId: string) =>
  prisma.group.findMany({
    where: { ownerId },
    orderBy: { createdAt: 'desc' },
    select: groupListSelect,
  });

export const getGroup = async (groupId: string, ownerId: string) =>
  getOwnedGroup(groupId, ownerId);

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
