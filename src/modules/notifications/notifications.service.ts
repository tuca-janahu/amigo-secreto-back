import {
  GroupStatus,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  Prisma,
} from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import { decryptData } from '../../lib/data-protection.js';
import { prisma } from '../../lib/prisma.js';
import {
  generateParticipantAccessToken,
  getParticipantAccessExpiration,
  hashParticipantAccessToken,
} from '../participant-access/participant-access.tokens.js';
import { sendInvitationEmail } from './resend.service.js';

const ownedGroupSelect = {
  id: true,
  name: true,
  status: true,
} satisfies Prisma.GroupSelect;

const protectedParticipantSelect = {
  id: true,
  groupId: true,
  nameEncrypted: true,
  emailEncrypted: true,
} satisfies Prisma.ParticipantSelect;

type ProtectedParticipant = Prisma.ParticipantGetPayload<{
  select: typeof protectedParticipantSelect;
}>;

type InvitationRecipient = {
  id: string;
  name: string;
  email: string;
};

export type InvitationAttemptStatus = 'SENT' | 'FAILED';

const invitationNotificationData = {
  type: NotificationType.SORTEIO_INVITATION,
  channel: NotificationChannel.EMAIL,
};

const getOwnedGroup = async (groupId: string, ownerId: string) => {
  const group = await prisma.group.findFirst({
    where: { id: groupId, ownerId },
    select: ownedGroupSelect,
  });

  if (!group) {
    throw new AppError(404, 'Group not found.');
  }

  return group;
};

const ensureSorteado = (status: GroupStatus): void => {
  if (status !== GroupStatus.SORTEADO) {
    throw new AppError(409, 'Invitations are available only for sorteado groups.');
  }
};

const getGroupParticipant = async (groupId: string, participantId: string) => {
  const participant = await prisma.participant.findFirst({
    where: { id: participantId, groupId },
    select: protectedParticipantSelect,
  });

  if (!participant) {
    throw new AppError(404, 'Participant not found.');
  }

  return participant;
};

const toInvitationRecipient = (participant: ProtectedParticipant): InvitationRecipient => ({
  id: participant.id,
  name: decryptData(participant.nameEncrypted),
  email: decryptData(participant.emailEncrypted),
});

const notificationErrorMessage = (): string => 'Unable to send invitation email.';

const deliverInvitation = async ({
  participant,
  groupName,
  token,
}: {
  participant: InvitationRecipient;
  groupName: string;
  token: string;
}): Promise<InvitationAttemptStatus> => {
  const notification = await prisma.notification.create({
    data: {
      participantId: participant.id,
      ...invitationNotificationData,
      status: NotificationStatus.PENDING,
    },
    select: { id: true },
  });

  try {
    const providerMessageId = await sendInvitationEmail({
      recipient: participant.email,
      participantName: participant.name,
      groupName,
      token,
    });

    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: NotificationStatus.SENT,
        providerMessageId,
        sentAt: new Date(),
      },
    });

    return 'SENT';
  } catch {
    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: NotificationStatus.FAILED,
        failedAt: new Date(),
        errorMessage: notificationErrorMessage(),
      },
    });

    return 'FAILED';
  }
};

const createReplacementAccess = async (participantId: string): Promise<string> => {
  const token = generateParticipantAccessToken();
  const now = new Date();

  await prisma.$transaction(async (transaction) => {
    await transaction.participantAccess.updateMany({
      where: { participantId, revokedAt: null },
      data: { revokedAt: now },
    });
    await transaction.participantAccess.create({
      data: {
        participantId,
        tokenHash: hashParticipantAccessToken(token),
        expiresAt: getParticipantAccessExpiration(now),
      },
    });
  });

  return token;
};

export const sendInitialInvitations = async (
  groupId: string,
  participantAccessTokens: Array<{ participantId: string; token: string }>,
): Promise<InvitationAttemptStatus[]> => {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      name: true,
      participants: {
        where: { id: { in: participantAccessTokens.map(({ participantId }) => participantId) } },
        select: protectedParticipantSelect,
      },
    },
  });

  if (!group) {
    throw new Error('Sorteado group not found.');
  }

  const tokenByParticipantId = new Map(
    participantAccessTokens.map(({ participantId, token }) => [participantId, token]),
  );

  return Promise.all(
    group.participants.map((participant) => {
      const token = tokenByParticipantId.get(participant.id);

      if (!token) {
        throw new Error('Participant access token not found.');
      }

      return deliverInvitation({
        participant: toInvitationRecipient(participant),
        groupName: group.name,
        token,
      });
    }),
  );
};

export const resendInvitation = async (
  groupId: string,
  participantId: string,
  ownerId: string,
): Promise<InvitationAttemptStatus> => {
  const group = await getOwnedGroup(groupId, ownerId);
  ensureSorteado(group.status);
  const participant = await getGroupParticipant(group.id, participantId);
  const token = await createReplacementAccess(participant.id);

  return deliverInvitation({
    participant: toInvitationRecipient(participant),
    groupName: group.name,
    token,
  });
};

export const resendPendingInvitations = async (groupId: string, ownerId: string) => {
  const group = await getOwnedGroup(groupId, ownerId);
  ensureSorteado(group.status);

  const participants = await prisma.participant.findMany({
    where: { groupId: group.id },
    select: {
      id: true,
      accesses: {
        where: { revealedAt: { not: null } },
        select: { id: true },
      },
      notifications: {
        where: invitationNotificationData,
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { status: true },
      },
    },
  });

  const eligibleParticipants = participants.filter(
    (participant) =>
      participant.accesses.length === 0 &&
      participant.notifications[0]?.status !== NotificationStatus.SENT,
  );
  let sent = 0;
  let failed = 0;

  for (const participant of eligibleParticipants) {
    try {
      const status = await resendInvitation(group.id, participant.id, ownerId);

      if (status === 'SENT') {
        sent += 1;
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return { attempted: eligibleParticipants.length, sent, failed };
};

export const listInvitationStatuses = async (groupId: string, ownerId: string) => {
  const group = await getOwnedGroup(groupId, ownerId);
  const participants = await prisma.participant.findMany({
    where: { groupId: group.id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      nameEncrypted: true,
      accesses: {
        where: { revealedAt: { not: null } },
        orderBy: { revealedAt: 'asc' },
        take: 1,
        select: { revealedAt: true },
      },
      notifications: {
        where: invitationNotificationData,
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { status: true, sentAt: true },
      },
    },
  });

  return participants.map((participant) => {
    const notification = participant.notifications[0];

    return {
      participantId: participant.id,
      name: decryptData(participant.nameEncrypted),
      status: notification?.status ?? NotificationStatus.PENDING,
      sentAt: notification?.sentAt ?? null,
      revealedAt: participant.accesses[0]?.revealedAt ?? null,
    };
  });
};
