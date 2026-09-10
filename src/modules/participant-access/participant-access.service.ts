import { Prisma } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import {
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
  new AppError(404, 'Participant access not found.');

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
