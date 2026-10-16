import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  participant: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  participantAccess: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));

import { createAuthToken } from '../src/lib/auth-token.js';
import {
  createEmailLookupHash,
  encryptData,
  encryptSorteioResult,
} from '../src/lib/data-protection.js';
import { app } from '../src/app.js';
import { hashParticipantAccessToken } from '../src/modules/participant-access/participant-access.tokens.js';
import { participantAccessRateLimiter } from '../src/middlewares/security.js';

type StoredParticipant = {
  id: string;
  groupId: string;
  nameEncrypted: string;
  emailEncrypted: string;
  emailLookupHash: string;
  userId: string | null;
};

type StoredAccess = {
  id: string;
  participantId: string;
  tokenHash: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  firstAccessedAt: Date | null;
  revealedAt: Date | null;
};

const participants = new Map<string, StoredParticipant>();
const accesses = new Map<string, StoredAccess>();
const assignments = new Map<
  string,
  ReturnType<typeof encryptSorteioResult>
>();
const users = new Map<string, { id: string; email: string }>();

const authCookie = (userId: string): string =>
  `auth_token=${createAuthToken(userId)}`;

const cuid = (number: number): string =>
  `c${number.toString().padStart(24, '0')}`;

const addParticipant = (
  id: string,
  groupId: string,
  name: string,
  email = `${name.toLowerCase()}@email.com`,
): StoredParticipant => {
  const participant = {
    id,
    groupId,
    nameEncrypted: encryptData(name),
    emailEncrypted: encryptData(email),
    emailLookupHash: createEmailLookupHash(email),
    userId: null,
  };
  participants.set(id, participant);
  return participant;
};

const addAccess = (token: string, participantId: string): StoredAccess => {
  const access = {
    id: `access-${participantId}`,
    participantId,
    tokenHash: hashParticipantAccessToken(token),
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    firstAccessedAt: null,
    revealedAt: null,
  };
  accesses.set(access.id, access);
  return access;
};

beforeEach(() => {
  participantAccessRateLimiter.resetKey('127.0.0.1');
  vi.clearAllMocks();
  participants.clear();
  accesses.clear();
  assignments.clear();
  users.clear();

  prismaMock.participantAccess.findUnique.mockImplementation(async ({ where }) => {
    const access = where.tokenHash
      ? [...accesses.values()].find(({ tokenHash }) => tokenHash === where.tokenHash)
      : accesses.get(where.id);

    if (!access) {
      return null;
    }

    if (!where.tokenHash) {
      return { revealedAt: access.revealedAt };
    }

    const participant = participants.get(access.participantId);

    if (!participant) {
      return null;
    }

    return {
      ...access,
      participant: {
        nameEncrypted: participant.nameEncrypted,
        emailLookupHash: participant.emailLookupHash,
        userId: participant.userId,
        group: { id: participant.groupId, name: 'Amigo Secreto 2026' },
        assignment: assignments.get(participant.id) ?? null,
      },
    };
  });
  prismaMock.participantAccess.findFirst.mockImplementation(async ({ where }) => {
    return (
      [...accesses.values()]
        .filter(
          (access) =>
            access.participantId === where.participantId &&
            access.revealedAt !== null,
        )
        .sort(
          (first, second) =>
            (first.revealedAt?.getTime() ?? 0) -
            (second.revealedAt?.getTime() ?? 0),
        )
        .map(({ revealedAt }) => ({ revealedAt }))[0] ?? null
    );
  });
  prismaMock.participantAccess.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.participantId) {
      const matchingAccesses = [...accesses.values()].filter(
        (access) =>
          access.participantId === where.participantId &&
          (where.revealedAt !== null || access.revealedAt === null),
      );

      for (const access of matchingAccesses) {
        Object.assign(access, data);
      }

      return { count: matchingAccesses.length };
    }

    const access = accesses.get(where.id);

    if (!access || (where.firstAccessedAt === null && access.firstAccessedAt !== null)) {
      return { count: 0 };
    }

    if (where.revealedAt === null && access.revealedAt !== null) {
      return { count: 0 };
    }

    Object.assign(access, data);
    return { count: 1 };
  });
  prismaMock.participant.findFirst.mockImplementation(async ({ where }) => {
    if (where.userId) {
      const participant = [...participants.values()].find(
        (storedParticipant) =>
          storedParticipant.groupId === where.groupId &&
          storedParticipant.userId === where.userId,
      );

      if (!participant) return null;

      return {
        id: participant.id,
        assignment: assignments.get(participant.id) ?? null,
        accesses: [...accesses.values()]
          .filter(
            (access) =>
              access.participantId === participant.id && access.revealedAt !== null,
          )
          .sort(
            (first, second) =>
              (first.revealedAt?.getTime() ?? 0) -
              (second.revealedAt?.getTime() ?? 0),
          )
          .slice(0, 1)
          .map(({ revealedAt }) => ({ revealedAt })),
      };
    }

    const participant = participants.get(where.id);
    return participant?.groupId === where.groupId
      ? { nameEncrypted: participant.nameEncrypted }
      : null;
  });
  prismaMock.participant.findUnique.mockImplementation(async ({ where }) => {
    const participant = participants.get(where.id);
    return participant ? { userId: participant.userId } : null;
  });
  prismaMock.participant.updateMany.mockImplementation(async ({ where, data }) => {
    const participant = participants.get(where.id);

    if (!participant || (where.userId === null && participant.userId !== null)) {
      return { count: 0 };
    }

    participant.userId = data.userId;
    return { count: 1 };
  });
  prismaMock.user.findUnique.mockImplementation(
    async ({ where }) => users.get(where.id) ?? null,
  );
});

describe('participant public access', () => {
  it('returns only the participant and group public data, recording first access once', async () => {
    const token = 'valid-token';
    const participant = addParticipant('giver', 'group-1', 'Lucas');
    const access = addAccess(token, participant.id);

    const firstResponse = await request(app).get(`/public/participant-access/${token}`);
    const firstAccessedAt = access.firstAccessedAt;
    const secondResponse = await request(app).get(`/public/participant-access/${token}`);

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body).toEqual({
      participant: { name: 'Lucas' },
      group: { id: 'group-1', name: 'Amigo Secreto 2026' },
      revealed: false,
    });
    expect(firstResponse.body).not.toHaveProperty('assignment');
    expect(firstResponse.body).not.toHaveProperty('receiverParticipantId');
    expect(access.firstAccessedAt).toBeInstanceOf(Date);
    expect(secondResponse.status).toBe(200);
    expect(access.firstAccessedAt).toBe(firstAccessedAt);
  });

  it.each([
    ['missing-token', (access: StoredAccess) => accesses.delete(access.id)],
    ['expired-token', (access: StoredAccess) => {
      access.expiresAt = new Date(Date.now() - 1);
    }],
    ['revoked-token', (access: StoredAccess) => {
      access.revokedAt = new Date();
    }],
  ])('rejects a %s access token', async (token, changeAccess) => {
    const access = addAccess(token, 'giver');
    addParticipant('giver', 'group-1', 'Lucas');
    changeAccess(access);

    const response = await request(app).get(`/public/participant-access/${token}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      message: 'Acesso do participante não encontrado.',
    });
  });
});

describe('participant access claim', () => {
  it('links a matching authenticated account and records first access once', async () => {
    const token = 'claim-token';
    const participant = addParticipant(
      'participant-1',
      'group-1',
      'Lucas',
      'lucas@email.com',
    );
    const access = addAccess(token, participant.id);
    users.set('user-1', { id: 'user-1', email: 'LUCAS@email.com' });

    const firstResponse = await request(app)
      .post(`/public/participant-access/${token}/claim`)
      .set('Cookie', authCookie('user-1'));
    const firstAccessedAt = access.firstAccessedAt;
    const secondResponse = await request(app)
      .post(`/public/participant-access/${token}/claim`)
      .set('Cookie', authCookie('user-1'));

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body).toEqual({
      participation: { groupId: 'group-1', participantId: participant.id },
    });
    expect(secondResponse.status).toBe(200);
    expect(participant.userId).toBe('user-1');
    expect(access.firstAccessedAt).toBe(firstAccessedAt);
    expect(firstAccessedAt).toBeInstanceOf(Date);
  });

  it('requires authentication and a matching account email', async () => {
    const participant = addParticipant(
      'participant-1',
      'group-1',
      'Lucas',
      'lucas@email.com',
    );
    const access = addAccess('claim-token', participant.id);
    users.set('user-1', { id: 'user-1', email: 'other@email.com' });

    const unauthenticatedResponse = await request(app).post(
      '/public/participant-access/claim-token/claim',
    );
    const mismatchedResponse = await request(app)
      .post('/public/participant-access/claim-token/claim')
      .set('Cookie', authCookie('user-1'));

    expect(unauthenticatedResponse.status).toBe(401);
    expect(mismatchedResponse.status).toBe(403);
    expect(participant.userId).toBeNull();
    expect(access.firstAccessedAt).toBeInstanceOf(Date);
  });

  it('rejects a participation already linked to another account', async () => {
    const participant = addParticipant(
      'participant-1',
      'group-1',
      'Lucas',
      'lucas@email.com',
    );
    participant.userId = 'user-2';
    addAccess('claim-token', participant.id);
    users.set('user-1', { id: 'user-1', email: 'lucas@email.com' });

    const response = await request(app)
      .post('/public/participant-access/claim-token/claim')
      .set('Cookie', authCookie('user-1'));

    expect(response.status).toBe(409);
  });

  it.each(['expired', 'revoked'] as const)(
    'rejects a %s token with the generic access error',
    async (state) => {
      const participant = addParticipant(
        'participant-1',
        'group-1',
        'Lucas',
        'lucas@email.com',
      );
      const access = addAccess(`${state}-claim-token`, participant.id);
      users.set('user-1', { id: 'user-1', email: 'lucas@email.com' });

      if (state === 'expired') access.expiresAt = new Date(Date.now() - 1);
      if (state === 'revoked') access.revokedAt = new Date();

      const response = await request(app)
        .post(`/public/participant-access/${state}-claim-token/claim`)
        .set('Cookie', authCookie('user-1'));

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        message: 'Acesso do participante não encontrado.',
      });
    },
  );
});

describe('participant result reveal', () => {
  it('reveals only the receiver name and keeps the original reveal time', async () => {
    const token = 'reveal-token';
    const giver = addParticipant('giver', 'group-1', 'Lucas');
    const receiver = addParticipant('receiver', 'group-1', 'Maria');
    const access = addAccess(token, giver.id);
    assignments.set(giver.id, encryptSorteioResult(receiver.id));

    const firstResponse = await request(app).post(
      `/public/participant-access/${token}/reveal`,
    );
    const firstRevealedAt = access.revealedAt;
    const secondResponse = await request(app).post(
      `/public/participant-access/${token}/reveal`,
    );

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body).toEqual({
      result: { name: 'Maria' },
      revealedAt: firstRevealedAt?.toJSON(),
    });
    expect(access.firstAccessedAt).toBeInstanceOf(Date);
    expect(access.revealedAt).toBeInstanceOf(Date);
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body).toEqual(firstResponse.body);
    expect(access.revealedAt).toBe(firstRevealedAt);
    expect(firstResponse.body.result.name).not.toBe('Lucas');
    expect(firstResponse.body.result).not.toHaveProperty('email');
  });

  it('keeps one first reveal timestamp for simultaneous reveal requests', async () => {
    const token = 'simultaneous-reveal-token';
    const giver = addParticipant('giver', 'group-1', 'Lucas');
    const receiver = addParticipant('receiver', 'group-1', 'Maria');
    const access = addAccess(token, giver.id);
    assignments.set(giver.id, encryptSorteioResult(receiver.id));

    const [firstResponse, secondResponse] = await Promise.all([
      request(app).post(`/public/participant-access/${token}/reveal`),
      request(app).post(`/public/participant-access/${token}/reveal`),
    ]);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(firstResponse.body).toEqual(secondResponse.body);
    expect(access.revealedAt).toBeInstanceOf(Date);
  });

  it('lets a linked participant reveal without the email token', async () => {
    const groupId = cuid(1);
    const giver = addParticipant('giver', groupId, 'Lucas');
    const receiver = addParticipant('receiver', groupId, 'Maria');
    const access = addAccess('original-token', giver.id);
    giver.userId = 'user-1';
    assignments.set(giver.id, encryptSorteioResult(receiver.id));

    const firstResponse = await request(app)
      .post(`/groups/${groupId}/reveal`)
      .set('Cookie', authCookie('user-1'));
    const secondResponse = await request(app)
      .post(`/groups/${groupId}/reveal`)
      .set('Cookie', authCookie('user-1'));

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body).toEqual({
      result: { name: 'Maria' },
      revealedAt: access.revealedAt?.toJSON(),
    });
    expect(secondResponse.body).toEqual(firstResponse.body);
    expect(firstResponse.body.result).not.toHaveProperty('id');
    expect(firstResponse.body).not.toHaveProperty('receiverParticipantId');
  });

  it('returns 404 when the authenticated user is not linked to the group', async () => {
    const response = await request(app)
      .post(`/groups/${cuid(1)}/reveal`)
      .set('Cookie', authCookie('user-1'));

    expect(response.status).toBe(404);
  });
});
