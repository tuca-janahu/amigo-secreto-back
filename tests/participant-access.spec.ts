import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  participant: {
    findFirst: vi.fn(),
  },
  participantAccess: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));

import { encryptData, encryptSorteioResult } from '../src/lib/data-protection.js';
import { app } from '../src/app.js';
import { hashParticipantAccessToken } from '../src/modules/participant-access/participant-access.tokens.js';

type StoredParticipant = {
  id: string;
  groupId: string;
  nameEncrypted: string;
  emailEncrypted: string;
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

const addParticipant = (id: string, groupId: string, name: string): StoredParticipant => {
  const participant = {
    id,
    groupId,
    nameEncrypted: encryptData(name),
    emailEncrypted: encryptData(`${name.toLowerCase()}@email.com`),
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
  vi.clearAllMocks();
  participants.clear();
  accesses.clear();
  assignments.clear();

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
        group: { id: participant.groupId, name: 'Amigo Secreto 2026' },
        assignment: assignments.get(participant.id) ?? null,
      },
    };
  });
  prismaMock.participantAccess.updateMany.mockImplementation(async ({ where, data }) => {
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
    const participant = participants.get(where.id);
    return participant?.groupId === where.groupId
      ? { nameEncrypted: participant.nameEncrypted }
      : null;
  });
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
});
