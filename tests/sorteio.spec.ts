import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  assignment: {
    createMany: vi.fn(),
  },
  participantAccess: {
    createMany: vi.fn(),
  },
  group: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  participant: {
    findMany: vi.fn(),
  },
  restriction: {
    findMany: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));

import { createAuthToken } from '../src/lib/auth-token.js';
import { decryptSorteioResult } from '../src/lib/data-protection.js';
import { app } from '../src/app.js';

type StoredGroup = {
  id: string;
  ownerId: string;
  status: 'DRAFT' | 'READY' | 'SORTEADO' | 'CANCELLED';
  sorteadoAt: Date | null;
};

type StoredParticipant = {
  id: string;
  groupId: string;
};

type StoredRestriction = {
  groupId: string;
  giverParticipantId: string;
  forbiddenParticipantId: string;
};

type StoredAssignment = {
  participantId: string;
  encryptedResult: string;
  iv: string;
  authTag: string;
};

type StoredParticipantAccess = {
  participantId: string;
  tokenHash: string;
  expiresAt: Date;
};

const groups = new Map<string, StoredGroup>();
const participants = new Map<string, StoredParticipant>();
const restrictions: StoredRestriction[] = [];
const assignments = new Map<string, StoredAssignment>();
const participantAccesses = new Map<string, StoredParticipantAccess>();
const cuid = (number: number): string =>
  `c${number.toString().padStart(24, '0')}`;

const authCookie = (userId: string): string =>
  `auth_token=${createAuthToken(userId)}`;

const addGroup = (
  id: string,
  ownerId: string,
  status: StoredGroup['status'] = 'DRAFT',
): StoredGroup => {
  const group = { id, ownerId, status, sorteadoAt: null };
  groups.set(id, group);
  return group;
};

const addParticipant = (id: string, groupId: string): StoredParticipant => {
  const participant = { id, groupId };
  participants.set(id, participant);
  return participant;
};

const addParticipants = (groupId: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => {
    const id = cuid(index + 10);
    addParticipant(id, groupId);
    return id;
  });

beforeEach(() => {
  vi.clearAllMocks();
  groups.clear();
  participants.clear();
  restrictions.length = 0;
  assignments.clear();
  participantAccesses.clear();

  prismaMock.group.findFirst.mockImplementation(async ({ where }) => {
    const group = groups.get(where.id);
    return group?.ownerId === where.ownerId ? group : null;
  });
  prismaMock.group.updateMany.mockImplementation(async ({ where, data }) => {
    const group = groups.get(where.id);

    if (!group || group.status !== where.status) {
      return { count: 0 };
    }

    group.status = data.status;
    group.sorteadoAt = data.sorteadoAt;
    return { count: 1 };
  });
  prismaMock.participant.findMany.mockImplementation(async ({ where }) =>
    [...participants.values()].filter((participant) => participant.groupId === where.groupId),
  );
  prismaMock.restriction.findMany.mockImplementation(async ({ where }) =>
    restrictions.filter((restriction) => restriction.groupId === where.groupId),
  );
  prismaMock.assignment.createMany.mockImplementation(async ({ data }) => {
    for (const assignment of data) {
      if (assignments.has(assignment.participantId)) {
        throw new Error('Assignment already exists.');
      }

      assignments.set(assignment.participantId, assignment);
    }

    return { count: data.length };
  });
  prismaMock.participantAccess.createMany.mockImplementation(async ({ data }) => {
    for (const access of data) {
      if ([...participantAccesses.values()].some(({ tokenHash }) => tokenHash === access.tokenHash)) {
        throw new Error('Participant access token already exists.');
      }

      participantAccesses.set(access.participantId, access);
    }

    return { count: data.length };
  });
  prismaMock.$transaction.mockImplementation(async (callback) =>
    callback({
      assignment: prismaMock.assignment,
      participantAccess: prismaMock.participantAccess,
      group: prismaMock.group,
      participant: prismaMock.participant,
      restriction: prismaMock.restriction,
    }),
  );
});

describe('sorteio viability', () => {
  it('marks groups with fewer than three participants as not viable', async () => {
    const groupId = cuid(1);
    addGroup(groupId, 'owner-1');
    addParticipants(groupId, 2);

    const response = await request(app)
      .get(`/groups/${groupId}/sorteio/viability`)
      .set('Cookie', authCookie('owner-1'));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      viable: false,
      reason: 'NOT_ENOUGH_PARTICIPANTS',
    });
  });

  it('marks a simple group as viable', async () => {
    const groupId = cuid(1);
    addGroup(groupId, 'owner-1');
    addParticipants(groupId, 3);

    const response = await request(app)
      .get(`/groups/${groupId}/sorteio/viability`)
      .set('Cookie', authCookie('owner-1'));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ viable: true });
  });

  it('marks impossible restrictions as not viable', async () => {
    const groupId = cuid(1);
    const [participantAId, participantBId, participantCId] = addParticipants(groupId, 3);
    addGroup(groupId, 'owner-1');
    restrictions.push(
      { groupId, giverParticipantId: participantAId, forbiddenParticipantId: participantBId },
      { groupId, giverParticipantId: participantAId, forbiddenParticipantId: participantCId },
    );

    const response = await request(app)
      .get(`/groups/${groupId}/sorteio/viability`)
      .set('Cookie', authCookie('owner-1'));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ viable: false, reason: 'NO_VALID_ASSIGNMENT' });
  });

  it('returns 404 to another user', async () => {
    const groupId = cuid(1);
    addGroup(groupId, 'owner-2');

    const response = await request(app)
      .get(`/groups/${groupId}/sorteio/viability`)
      .set('Cookie', authCookie('owner-1'));

    expect(response.status).toBe(404);
  });
});

describe('POST /groups/:groupId/sorteio', () => {
  it('creates encrypted assignments and marks the group as SORTEADO', async () => {
    const groupId = cuid(1);
    const [participantAId, participantBId, participantCId] = addParticipants(groupId, 3);
    const group = addGroup(groupId, 'owner-1');
    restrictions.push({
      groupId,
      giverParticipantId: participantAId,
      forbiddenParticipantId: participantBId,
    });

    const response = await request(app)
      .post(`/groups/${groupId}/sorteio`)
      .set('Cookie', authCookie('owner-1'));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      group: expect.objectContaining({ id: groupId, status: 'SORTEADO' }),
    });
    expect(response.body).not.toHaveProperty('assignments');
    expect(response.body.group).not.toHaveProperty('receiverParticipantId');
    expect(group.status).toBe('SORTEADO');
    expect(group.sorteadoAt).toBeInstanceOf(Date);
    expect(assignments.size).toBe(3);
    expect(participantAccesses.size).toBe(3);
    expect([...assignments.keys()].sort()).toEqual(
      [participantAId, participantBId, participantCId].sort(),
    );
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();

    const receivers = new Set<string>();

    for (const assignment of assignments.values()) {
      expect(assignment).not.toHaveProperty('receiverParticipantId');
      const { receiverParticipantId } = decryptSorteioResult(assignment);
      expect([participantAId, participantBId, participantCId]).toContain(
        receiverParticipantId,
      );
      expect(receiverParticipantId).not.toBe(assignment.participantId);
      expect(
        restrictions.some(
          (restriction) =>
            restriction.giverParticipantId === assignment.participantId &&
            restriction.forbiddenParticipantId === receiverParticipantId,
        ),
      ).toBe(false);
      receivers.add(receiverParticipantId);
    }

    expect(receivers.size).toBe(3);

    for (const [participantId, access] of participantAccesses) {
      expect([participantAId, participantBId, participantCId]).toContain(participantId);
      expect(access).not.toHaveProperty('token');
      expect(access.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(access.expiresAt).toBeInstanceOf(Date);
    }
  });

  it('does not create a sorteio without a valid assignment', async () => {
    const groupId = cuid(1);
    const [participantAId, participantBId, participantCId] = addParticipants(groupId, 3);
    const group = addGroup(groupId, 'owner-1');
    restrictions.push(
      { groupId, giverParticipantId: participantAId, forbiddenParticipantId: participantBId },
      { groupId, giverParticipantId: participantAId, forbiddenParticipantId: participantCId },
    );

    const response = await request(app)
      .post(`/groups/${groupId}/sorteio`)
      .set('Cookie', authCookie('owner-1'));

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'SORTEIO_NOT_VIABLE' });
    expect(group.status).toBe('DRAFT');
    expect(assignments.size).toBe(0);
  });

  it('returns 404 when another user tries to create a sorteio', async () => {
    const groupId = cuid(1);
    addGroup(groupId, 'owner-2');
    addParticipants(groupId, 3);

    const response = await request(app)
      .post(`/groups/${groupId}/sorteio`)
      .set('Cookie', authCookie('owner-1'));

    expect(response.status).toBe(404);
    expect(assignments.size).toBe(0);
  });

  it('does not create a sorteio for an already SORTEADO group again', async () => {
    const groupId = cuid(1);
    const group = addGroup(groupId, 'owner-1', 'SORTEADO');
    addParticipants(groupId, 3);

    const response = await request(app)
      .post(`/groups/${groupId}/sorteio`)
      .set('Cookie', authCookie('owner-1'));

    expect(response.status).toBe(409);
    expect(group.status).toBe('SORTEADO');
    expect(assignments.size).toBe(0);
  });
});
