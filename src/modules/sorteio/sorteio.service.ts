import { GroupStatus, Prisma } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import { encryptSorteioResult } from '../../lib/data-protection.js';
import { prisma } from '../../lib/prisma.js';
import {
  generateParticipantAccessToken,
  getParticipantAccessExpiration,
  hashParticipantAccessToken,
} from '../participant-access/participant-access.tokens.js';
import {
  findSorteioMatching,
  type SorteioRestriction,
} from './sorteio.engine.js';

const MINIMUM_PARTICIPANTS = 3;

const ownedGroupSelect = {
  id: true,
  status: true,
} satisfies Prisma.GroupSelect;

const groupParticipantSelect = {
  id: true,
} satisfies Prisma.ParticipantSelect;

const groupRestrictionSelect = {
  giverParticipantId: true,
  forbiddenParticipantId: true,
} satisfies Prisma.RestrictionSelect;

type PrismaClient = Prisma.TransactionClient | typeof prisma;

type SorteioData = {
  participantIds: string[];
  restrictions: SorteioRestriction[];
};

export type SorteioViability =
  | { viable: true }
  | { viable: false; reason: 'NOT_ENOUGH_PARTICIPANTS' | 'NO_VALID_ASSIGNMENT' };

export type ParticipantAccessToken = {
  participantId: string;
  token: string;
};

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

const getSorteioData = async (
  client: PrismaClient,
  groupId: string,
): Promise<SorteioData> => {
  const [participants, restrictions] = await Promise.all([
    client.participant.findMany({
      where: { groupId },
      select: groupParticipantSelect,
    }),
    client.restriction.findMany({
      where: { groupId },
      select: groupRestrictionSelect,
    }),
  ]);

  return {
    participantIds: participants.map((participant) => participant.id),
    restrictions,
  };
};

const getViability = ({
  participantIds,
  restrictions,
}: SorteioData): SorteioViability => {
  if (participantIds.length < MINIMUM_PARTICIPANTS) {
    return { viable: false, reason: 'NOT_ENOUGH_PARTICIPANTS' };
  }

  return findSorteioMatching(participantIds, restrictions)
    ? { viable: true }
    : { viable: false, reason: 'NO_VALID_ASSIGNMENT' };
};

const ensureDraft = (status: GroupStatus): void => {
  if (status !== GroupStatus.DRAFT) {
    throw new AppError(409, 'O grupo só pode ser sorteado enquanto estiver em rascunho.');
  }
};

const sorteioNotViableError = (): AppError =>
  new AppError(409, 'O sorteio não é viável.', 'SORTEIO_NOT_VIABLE');

export const getSorteioViability = async (
  groupId: string,
  ownerId: string,
): Promise<SorteioViability> => {
  const group = await getOwnedGroup(prisma, groupId, ownerId);
  const sorteioData = await getSorteioData(prisma, group.id);

  return getViability(sorteioData);
};

export const sortearGrupo = async (groupId: string, ownerId: string) =>
  prisma.$transaction(async (transaction) => {
    const group = await getOwnedGroup(transaction, groupId, ownerId);
    ensureDraft(group.status);

    const sorteioData = await getSorteioData(transaction, group.id);
    const viability = getViability(sorteioData);

    if (!viability.viable) {
      throw sorteioNotViableError();
    }

    const matching = findSorteioMatching(
      sorteioData.participantIds,
      sorteioData.restrictions,
    );

    if (!matching) {
      throw sorteioNotViableError();
    }

    const sorteadoAt = new Date();
    const updatedGroup = await transaction.group.updateMany({
      where: { id: group.id, status: GroupStatus.DRAFT },
      data: { status: GroupStatus.SORTEADO, sorteadoAt },
    });

    if (updatedGroup.count !== 1) {
      throw new AppError(409, 'O grupo só pode ser sorteado uma vez.');
    }

    await transaction.assignment.createMany({
      data: sorteioData.participantIds.map((participantId) => {
        const receiverParticipantId = matching.get(participantId);

        if (!receiverParticipantId) {
          throw new Error('Sorteio matching is incomplete.');
        }

        return {
          participantId,
          ...encryptSorteioResult(receiverParticipantId),
        };
      }),
    });

    const participantAccessTokens: ParticipantAccessToken[] =
      sorteioData.participantIds.map((participantId) => ({
        participantId,
        token: generateParticipantAccessToken(),
      }));

    await transaction.participantAccess.createMany({
      data: participantAccessTokens.map(({ participantId, token }) => ({
        participantId,
        tokenHash: hashParticipantAccessToken(token),
        expiresAt: getParticipantAccessExpiration(sorteadoAt),
      })),
    });

    return {
      group: {
        id: group.id,
        status: GroupStatus.SORTEADO,
        sorteadoAt,
      },
      participantAccessTokens,
    };
  });
