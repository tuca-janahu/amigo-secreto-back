import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendInvitationEmailMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  group: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  notification: {
    create: vi.fn(),
    update: vi.fn(),
  },
  participant: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  participantAccess: {
    create: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/modules/notifications/resend.service.js', () => ({
  sendInvitationEmail: sendInvitationEmailMock,
}));

import { createAuthToken } from '../src/lib/auth-token.js';
import { encryptData } from '../src/lib/data-protection.js';
import { app } from '../src/app.js';
import {
  sendInitialInvitations,
} from '../src/modules/notifications/notifications.service.js';

type StoredGroup = {
  id: string;
  ownerId: string;
  name: string;
  status: 'DRAFT' | 'READY' | 'SORTEADO' | 'CANCELLED';
};

type StoredParticipant = {
  id: string;
  groupId: string;
  nameEncrypted: string;
  emailEncrypted: string;
  createdAt: Date;
};

type StoredAccess = {
  id: string;
  participantId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revealedAt: Date | null;
};

type StoredNotification = {
  id: string;
  participantId: string;
  type: 'SORTEIO_INVITATION';
  channel: 'EMAIL';
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';
  providerMessageId: string | null;
  sentAt: Date | null;
  failedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
};

const groups = new Map<string, StoredGroup>();
const participants = new Map<string, StoredParticipant>();
const accesses = new Map<string, StoredAccess>();
const notifications = new Map<string, StoredNotification>();
const cuid = (number: number): string =>
  `c${number.toString().padStart(24, '0')}`;

const authCookie = (userId: string): string =>
  `auth_token=${createAuthToken(userId)}`;

const addGroup = (
  id: string,
  ownerId: string,
  status: StoredGroup['status'] = 'SORTEADO',
): StoredGroup => {
  const group = { id, ownerId, name: `Group ${id}`, status };
  groups.set(id, group);
  return group;
};

const addParticipant = (
  id: string,
  groupId: string,
  name: string,
): StoredParticipant => {
  const participant = {
    id,
    groupId,
    nameEncrypted: encryptData(name),
    emailEncrypted: encryptData(`${name.toLowerCase()}@email.com`),
    createdAt: new Date(),
  };
  participants.set(id, participant);
  return participant;
};

const addAccess = (
  id: string,
  participantId: string,
  revealedAt: Date | null = null,
): StoredAccess => {
  const access = {
    id,
    participantId,
    tokenHash: `hash-${id}`,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    revealedAt,
  };
  accesses.set(id, access);
  return access;
};

const addNotification = (
  id: string,
  participantId: string,
  status: StoredNotification['status'],
): StoredNotification => {
  const notification = {
    id,
    participantId,
    type: 'SORTEIO_INVITATION' as const,
    channel: 'EMAIL' as const,
    status,
    providerMessageId: null,
    sentAt: null,
    failedAt: null,
    errorMessage: null,
    createdAt: new Date(),
  };
  notifications.set(id, notification);
  return notification;
};

beforeEach(() => {
  vi.clearAllMocks();
  groups.clear();
  participants.clear();
  accesses.clear();
  notifications.clear();

  prismaMock.group.findFirst.mockImplementation(async ({ where }) => {
    const group = groups.get(where.id);
    return group?.ownerId === where.ownerId ? group : null;
  });
  prismaMock.group.findUnique.mockImplementation(async ({ where }) => {
    const group = groups.get(where.id);

    return group
      ? {
          ...group,
          participants: [...participants.values()].filter(
            (participant) => participant.groupId === group.id,
          ),
        }
      : null;
  });
  prismaMock.participant.findFirst.mockImplementation(async ({ where }) => {
    const participant = participants.get(where.id);
    return participant?.groupId === where.groupId ? participant : null;
  });
  prismaMock.participant.findMany.mockImplementation(async ({ where }) =>
    [...participants.values()]
      .filter((participant) => participant.groupId === where.groupId)
      .sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime())
      .map((participant) => ({
        ...participant,
        accesses: [...accesses.values()].filter(
          (access) =>
            access.participantId === participant.id && access.revealedAt !== null,
        ),
        notifications: [...notifications.values()]
          .filter((notification) => notification.participantId === participant.id)
          .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())
          .slice(0, 1),
      })),
  );
  prismaMock.notification.create.mockImplementation(async ({ data }) => {
    const notification = addNotification(
      `notification-${notifications.size + 1}`,
      data.participantId,
      data.status,
    );
    return { id: notification.id };
  });
  prismaMock.notification.update.mockImplementation(async ({ where, data }) => {
    const notification = notifications.get(where.id);

    if (!notification) {
      throw new Error('Notification not found.');
    }

    Object.assign(notification, data);
    return notification;
  });
  prismaMock.participantAccess.updateMany.mockImplementation(async ({ where, data }) => {
    const activeAccesses = [...accesses.values()].filter(
      (access) => access.participantId === where.participantId && access.revokedAt === null,
    );
    activeAccesses.forEach((access) => Object.assign(access, data));
    return { count: activeAccesses.length };
  });
  prismaMock.participantAccess.create.mockImplementation(async ({ data }) => {
    const access = {
      id: `access-${accesses.size + 1}`,
      participantId: data.participantId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      revokedAt: null,
      revealedAt: null,
    };
    accesses.set(access.id, access);
    return access;
  });
  prismaMock.$transaction.mockImplementation(async (callback) =>
    callback({ participantAccess: prismaMock.participantAccess }),
  );
});

describe('initial invitation delivery', () => {
  it('records SENT and FAILED independently without affecting the sorteado group', async () => {
    const groupId = cuid(1);
    const group = addGroup(groupId, 'owner-1');
    const firstParticipant = addParticipant(cuid(10), groupId, 'Lucas');
    const secondParticipant = addParticipant(cuid(11), groupId, 'Maria');
    sendInvitationEmailMock
      .mockResolvedValueOnce('provider-message-1')
      .mockRejectedValueOnce(new Error('Provider unavailable'));

    const statuses = await sendInitialInvitations(groupId, [
      { participantId: firstParticipant.id, token: 'first-token' },
      { participantId: secondParticipant.id, token: 'second-token' },
    ]);

    expect(statuses).toEqual(['SENT', 'FAILED']);
    expect(group.status).toBe('SORTEADO');
    expect([...notifications.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantId: firstParticipant.id,
          status: 'SENT',
          providerMessageId: 'provider-message-1',
          sentAt: expect.any(Date),
        }),
        expect.objectContaining({
          participantId: secondParticipant.id,
          status: 'FAILED',
          failedAt: expect.any(Date),
          errorMessage: 'Unable to send invitation email.',
        }),
      ]),
    );
    expect(sendInvitationEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: 'lucas@email.com', token: 'first-token' }),
    );
  });
});

describe('invitation resends', () => {
  it('allows the owner to resend, revoking the previous access and storing no token', async () => {
    const groupId = cuid(1);
    const participantId = cuid(10);
    addGroup(groupId, 'owner-1');
    addParticipant(participantId, groupId, 'Lucas');
    const oldAccess = addAccess('old-access', participantId);
    sendInvitationEmailMock.mockResolvedValue('provider-message-1');

    const response = await request(app)
      .post(`/groups/${groupId}/participants/${participantId}/invite/resend`)
      .set('Cookie', authCookie('owner-1'));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'SENT' });
    expect(oldAccess.revokedAt).toBeInstanceOf(Date);
    expect([...accesses.values()]).toHaveLength(2);
    const newAccess = [...accesses.values()].find((access) => access.id !== oldAccess.id);
    expect(newAccess?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(newAccess).not.toHaveProperty('token');
    expect(response.body).not.toHaveProperty('token');
  });

  it('rejects another owner, a participant from another group, and groups not sorteado', async () => {
    const firstGroupId = cuid(1);
    const secondGroupId = cuid(2);
    const participantId = cuid(10);
    const otherParticipantId = cuid(11);
    addGroup(firstGroupId, 'owner-1');
    addGroup(secondGroupId, 'owner-2');
    addParticipant(participantId, firstGroupId, 'Lucas');
    addParticipant(otherParticipantId, secondGroupId, 'Maria');

    const otherOwnerResponse = await request(app)
      .post(`/groups/${firstGroupId}/participants/${participantId}/invite/resend`)
      .set('Cookie', authCookie('owner-2'));
    const otherParticipantResponse = await request(app)
      .post(`/groups/${firstGroupId}/participants/${otherParticipantId}/invite/resend`)
      .set('Cookie', authCookie('owner-1'));

    groups.get(firstGroupId)!.status = 'DRAFT';
    const draftResponse = await request(app)
      .post(`/groups/${firstGroupId}/participants/${participantId}/invite/resend`)
      .set('Cookie', authCookie('owner-1'));

    expect(otherOwnerResponse.status).toBe(404);
    expect(otherParticipantResponse.status).toBe(404);
    expect(draftResponse.status).toBe(409);
  });

  it('resends only pending or failed participants, skips revealed participants, and tolerates failures', async () => {
    const groupId = cuid(1);
    const failedParticipant = addParticipant(cuid(10), groupId, 'Lucas');
    const sentParticipant = addParticipant(cuid(11), groupId, 'Maria');
    const revealedParticipant = addParticipant(cuid(12), groupId, 'João');
    const secondFailedParticipant = addParticipant(cuid(13), groupId, 'Ana');
    addGroup(groupId, 'owner-1');
    addNotification('failed-notification', failedParticipant.id, 'FAILED');
    addNotification('sent-notification', sentParticipant.id, 'SENT');
    addNotification('revealed-notification', revealedParticipant.id, 'FAILED');
    addNotification('second-failed-notification', secondFailedParticipant.id, 'FAILED');
    addAccess('revealed-access', revealedParticipant.id, new Date());
    sendInvitationEmailMock
      .mockResolvedValueOnce('provider-message-1')
      .mockRejectedValueOnce(new Error('Provider unavailable'));

    const response = await request(app)
      .post(`/groups/${groupId}/invitations/resend-pending`)
      .set('Cookie', authCookie('owner-1'));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ attempted: 2, sent: 1, failed: 1 });
    expect(sendInvitationEmailMock).toHaveBeenCalledTimes(2);
  });
});

describe('invitation statuses', () => {
  it('returns owner-safe status data, including revealedAt, without results or tokens', async () => {
    const groupId = cuid(1);
    const participant = addParticipant(cuid(10), groupId, 'Lucas');
    addGroup(groupId, 'owner-1');
    const sentNotification = addNotification('sent-notification', participant.id, 'SENT');
    sentNotification.sentAt = new Date('2026-01-01T00:00:00.000Z');
    const revealedAt = new Date('2026-01-02T00:00:00.000Z');
    addAccess('revealed-access', participant.id, revealedAt);

    const response = await request(app)
      .get(`/groups/${groupId}/invitations`)
      .set('Cookie', authCookie('owner-1'));

    expect(response.status).toBe(200);
    expect(response.body.participants).toEqual([
      {
        participantId: participant.id,
        name: 'Lucas',
        status: 'SENT',
        sentAt: sentNotification.sentAt.toJSON(),
        revealedAt: revealedAt.toJSON(),
      },
    ]);
    expect(response.body).not.toHaveProperty('token');
    expect(response.body).not.toHaveProperty('receiverParticipantId');
    expect(response.body).not.toHaveProperty('assignment');
  });

  it('does not expose status to another owner', async () => {
    const groupId = cuid(1);
    addGroup(groupId, 'owner-2');

    const response = await request(app)
      .get(`/groups/${groupId}/invitations`)
      .set('Cookie', authCookie('owner-1'));

    expect(response.status).toBe(404);
  });
});
