import { GroupStatus, Prisma } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import { prisma } from '../../lib/prisma.js';
import { getParticipantAccessGroup } from '../participant-access/participant-access.service.js';
import type { CreateMessageInput } from './messages.schemas.js';

const messageSelect = {
  id: true,
  content: true,
  createdAt: true,
} satisfies Prisma.AnonymousMessageSelect;

type PublicMessage = Prisma.AnonymousMessageGetPayload<{
  select: typeof messageSelect;
}>;

const participantAccessUnavailableError = (): AppError =>
  new AppError(404, 'Participant access not found.');

const getParticipantMessageGroup = async (token: string) => {
  const group = await getParticipantAccessGroup(token);

  if (group.status !== GroupStatus.SORTEADO) {
    throw participantAccessUnavailableError();
  }

  return group;
};

const getOwnedGroup = async (groupId: string, ownerId: string) => {
  const group = await prisma.group.findFirst({
    where: { id: groupId, ownerId },
    select: { id: true },
  });

  if (!group) {
    throw new AppError(404, 'Group not found.');
  }

  return group;
};

export const listParticipantMessages = async (token: string) => {
  const group = await getParticipantMessageGroup(token);

  return prisma.anonymousMessage.findMany({
    where: { groupId: group.id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: messageSelect,
  });
};

export const createParticipantMessage = async (
  token: string,
  { content }: CreateMessageInput,
): Promise<PublicMessage> => {
  const group = await getParticipantMessageGroup(token);

  return prisma.anonymousMessage.create({
    data: { groupId: group.id, content },
    select: messageSelect,
  });
};

export const listOwnerMessages = async (groupId: string, ownerId: string) => {
  const group = await getOwnedGroup(groupId, ownerId);

  return prisma.anonymousMessage.findMany({
    where: { groupId: group.id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: messageSelect,
  });
};

export const deleteOwnerMessage = async (
  groupId: string,
  messageId: string,
  ownerId: string,
): Promise<void> => {
  const group = await getOwnedGroup(groupId, ownerId);
  const deletedMessage = await prisma.anonymousMessage.updateMany({
    where: { id: messageId, groupId: group.id, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  if (deletedMessage.count !== 1) {
    throw new AppError(404, 'Message not found.');
  }
};
