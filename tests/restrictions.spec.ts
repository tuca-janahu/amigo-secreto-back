import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  group: {
    findFirst: vi.fn(),
  },
  participant: {
    findMany: vi.fn(),
  },
  restriction: {
    create: vi.fn(),
    delete: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));

import { createAuthToken } from '../src/lib/auth-token.js';
import { encryptData } from '../src/lib/data-protection.js';
import { app } from '../src/app.js';

type StoredGroup = {
  id: string;
  ownerId: string;
  status: 'DRAFT' | 'READY' | 'DRAWN' | 'CANCELLED';
};

type StoredParticipant = {
  id: string;
  groupId: string;
  nameEncrypted: string;
};

type StoredRestriction = {
  id: string;
  groupId: string;
  giverParticipantId: string;
  forbiddenParticipantId: string;
  createdAt: Date;
};

const groups = new Map<string, StoredGroup>();
const participants = new Map<string, StoredParticipant>();
const restrictions = new Map<string, StoredRestriction>();
const cuid = (number: number): string =>
  `c${number.toString().padStart(24, '0')}`;

const authCookie = (userId: string): string =>
  `auth_token=${createAuthToken(userId)}`;

const addGroup = (
  id: string,
  ownerId: string,
  status: StoredGroup['status'] = 'DRAFT',
): StoredGroup => {
  const group = { id, ownerId, status };
  groups.set(id, group);
  return group;
};

const addParticipant = (id: string, groupId: string, name: string): StoredParticipant => {
  const participant = { id, groupId, nameEncrypted: encryptData(name) };
  participants.set(id, participant);
  return participant;
};

const addRestriction = (
  groupId: string,
  giverParticipantId: string,
  forbiddenParticipantId: string,
): StoredRestriction => {
  const restriction = {
    id: cuid(restrictions.size + 100),
    groupId,
    giverParticipantId,
    forbiddenParticipantId,
    createdAt: new Date(),
  };
  restrictions.set(restriction.id, restriction);
  return restriction;
};

beforeEach(() => {
  vi.clearAllMocks();
  groups.clear();
  participants.clear();
  restrictions.clear();

  prismaMock.group.findFirst.mockImplementation(async ({ where }) => {
    const group = groups.get(where.id);
    return group?.ownerId === where.ownerId ? group : null;
  });
  prismaMock.participant.findMany.mockImplementation(async ({ where }) =>
    [...participants.values()].filter(
      (participant) =>
        participant.groupId === where.groupId && where.id.in.includes(participant.id),
    ),
  );
  prismaMock.restriction.findFirst.mockImplementation(async ({ where }) =>
    [...restrictions.values()].find(
      (restriction) =>
        restriction.groupId === where.groupId &&
        (!where.id || restriction.id === where.id) &&
        (!where.giverParticipantId ||
          restriction.giverParticipantId === where.giverParticipantId) &&
        (!where.forbiddenParticipantId ||
          restriction.forbiddenParticipantId === where.forbiddenParticipantId),
    ) ?? null,
  );
  prismaMock.restriction.findMany.mockImplementation(async ({ where }) =>
    [...restrictions.values()]
      .filter((restriction) => restriction.groupId === where.groupId)
      .sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime())
      .map((restriction) => ({
        id: restriction.id,
        createdAt: restriction.createdAt,
        giverParticipant: participants.get(restriction.giverParticipantId),
        forbiddenParticipant: participants.get(restriction.forbiddenParticipantId),
      })),
  );
  prismaMock.restriction.create.mockImplementation(async ({ data }) =>
    addRestriction(
      data.groupId,
      data.giverParticipantId,
      data.forbiddenParticipantId,
    ),
  );
  prismaMock.restriction.delete.mockImplementation(async ({ where }) => {
    const restriction = restrictions.get(where.id);

    if (!restriction) {
      throw new Error('Restriction not found.');
    }

    restrictions.delete(restriction.id);
    return restriction;
  });
  prismaMock.$transaction.mockImplementation(async (callback) =>
    callback({
      group: prismaMock.group,
      participant: prismaMock.participant,
      restriction: prismaMock.restriction,
    }),
  );
});

describe('restrictions', () => {
  describe('POST /groups/:groupId/restrictions', () => {
    it('allows an owner to create a directional restriction', async () => {
      const groupId = cuid(1);
      const giverId = cuid(10);
      const forbiddenId = cuid(11);
      addGroup(groupId, 'owner-1');
      addParticipant(giverId, groupId, 'Lucas');
      addParticipant(forbiddenId, groupId, 'Maria');

      const response = await request(app)
        .post(`/groups/${groupId}/restrictions`)
        .set('Cookie', authCookie('owner-1'))
        .send({ giverParticipantId: giverId, forbiddenParticipantId: forbiddenId });

      expect(response.status).toBe(201);
      expect(response.body.restriction).toMatchObject({
        giverParticipantId: giverId,
        forbiddenParticipantId: forbiddenId,
      });
      expect(restrictions.size).toBe(1);
    });

    it('returns 404 when another user tries to create a restriction', async () => {
      const groupId = cuid(1);
      const giverId = cuid(10);
      const forbiddenId = cuid(11);
      addGroup(groupId, 'owner-2');
      addParticipant(giverId, groupId, 'Lucas');
      addParticipant(forbiddenId, groupId, 'Maria');

      const response = await request(app)
        .post(`/groups/${groupId}/restrictions`)
        .set('Cookie', authCookie('owner-1'))
        .send({ giverParticipantId: giverId, forbiddenParticipantId: forbiddenId });

      expect(response.status).toBe(404);
    });

    it('rejects a participant from another group', async () => {
      const groupId = cuid(1);
      const otherGroupId = cuid(2);
      const giverId = cuid(10);
      const forbiddenId = cuid(11);
      addGroup(groupId, 'owner-1');
      addGroup(otherGroupId, 'owner-1');
      addParticipant(giverId, groupId, 'Lucas');
      addParticipant(forbiddenId, otherGroupId, 'Maria');

      const response = await request(app)
        .post(`/groups/${groupId}/restrictions`)
        .set('Cookie', authCookie('owner-1'))
        .send({ giverParticipantId: giverId, forbiddenParticipantId: forbiddenId });

      expect(response.status).toBe(404);
      expect(restrictions.size).toBe(0);
    });

    it('rejects self restrictions and duplicates', async () => {
      const groupId = cuid(1);
      const giverId = cuid(10);
      const forbiddenId = cuid(11);
      addGroup(groupId, 'owner-1');
      addParticipant(giverId, groupId, 'Lucas');
      addParticipant(forbiddenId, groupId, 'Maria');

      const selfResponse = await request(app)
        .post(`/groups/${groupId}/restrictions`)
        .set('Cookie', authCookie('owner-1'))
        .send({ giverParticipantId: giverId, forbiddenParticipantId: giverId });
      const firstResponse = await request(app)
        .post(`/groups/${groupId}/restrictions`)
        .set('Cookie', authCookie('owner-1'))
        .send({ giverParticipantId: giverId, forbiddenParticipantId: forbiddenId });
      const duplicateResponse = await request(app)
        .post(`/groups/${groupId}/restrictions`)
        .set('Cookie', authCookie('owner-1'))
        .send({ giverParticipantId: giverId, forbiddenParticipantId: forbiddenId });

      expect(selfResponse.status).toBe(400);
      expect(firstResponse.status).toBe(201);
      expect(duplicateResponse.status).toBe(409);
      expect(restrictions.size).toBe(1);
    });

    it('rejects creation outside DRAFT', async () => {
      const groupId = cuid(1);
      const giverId = cuid(10);
      const forbiddenId = cuid(11);
      addGroup(groupId, 'owner-1', 'READY');
      addParticipant(giverId, groupId, 'Lucas');
      addParticipant(forbiddenId, groupId, 'Maria');

      const response = await request(app)
        .post(`/groups/${groupId}/restrictions`)
        .set('Cookie', authCookie('owner-1'))
        .send({ giverParticipantId: giverId, forbiddenParticipantId: forbiddenId });

      expect(response.status).toBe(409);
    });
  });

  describe('POST /groups/:groupId/restrictions/bilateral', () => {
    it('creates both directions atomically', async () => {
      const groupId = cuid(1);
      const participantAId = cuid(10);
      const participantBId = cuid(11);
      addGroup(groupId, 'owner-1');
      addParticipant(participantAId, groupId, 'Lucas');
      addParticipant(participantBId, groupId, 'Maria');

      const response = await request(app)
        .post(`/groups/${groupId}/restrictions/bilateral`)
        .set('Cookie', authCookie('owner-1'))
        .send({ participantAId, participantBId });

      expect(response.status).toBe(201);
      expect(response.body.restrictions).toHaveLength(2);
      expect(restrictions.size).toBe(2);
      expect([...restrictions.values()]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            giverParticipantId: participantAId,
            forbiddenParticipantId: participantBId,
          }),
          expect.objectContaining({
            giverParticipantId: participantBId,
            forbiddenParticipantId: participantAId,
          }),
        ]),
      );
      expect(prismaMock.$transaction).toHaveBeenCalledOnce();
    });

    it('returns 409 without changes when either direction already exists', async () => {
      const groupId = cuid(1);
      const participantAId = cuid(10);
      const participantBId = cuid(11);
      addGroup(groupId, 'owner-1');
      addParticipant(participantAId, groupId, 'Lucas');
      addParticipant(participantBId, groupId, 'Maria');
      addRestriction(groupId, participantAId, participantBId);

      const response = await request(app)
        .post(`/groups/${groupId}/restrictions/bilateral`)
        .set('Cookie', authCookie('owner-1'))
        .send({ participantAId, participantBId });

      expect(response.status).toBe(409);
      expect(restrictions.size).toBe(1);
    });

    it('rejects bilateral creation outside DRAFT', async () => {
      const groupId = cuid(1);
      const participantAId = cuid(10);
      const participantBId = cuid(11);
      addGroup(groupId, 'owner-1', 'DRAWN');
      addParticipant(participantAId, groupId, 'Lucas');
      addParticipant(participantBId, groupId, 'Maria');

      const response = await request(app)
        .post(`/groups/${groupId}/restrictions/bilateral`)
        .set('Cookie', authCookie('owner-1'))
        .send({ participantAId, participantBId });

      expect(response.status).toBe(409);
      expect(restrictions.size).toBe(0);
    });
  });

  describe('GET /groups/:groupId/restrictions', () => {
    it('returns only its group restrictions with decrypted names', async () => {
      const groupId = cuid(1);
      const otherGroupId = cuid(2);
      const giverId = cuid(10);
      const forbiddenId = cuid(11);
      const otherParticipantId = cuid(12);
      addGroup(groupId, 'owner-1');
      addGroup(otherGroupId, 'owner-1');
      addParticipant(giverId, groupId, 'Lucas');
      addParticipant(forbiddenId, groupId, 'Maria');
      addParticipant(otherParticipantId, otherGroupId, 'Joana');
      addRestriction(groupId, giverId, forbiddenId);
      addRestriction(otherGroupId, otherParticipantId, otherParticipantId);

      const response = await request(app)
        .get(`/groups/${groupId}/restrictions`)
        .set('Cookie', authCookie('owner-1'));

      expect(response.status).toBe(200);
      expect(response.body.restrictions).toEqual([
        expect.objectContaining({
          giver: { id: giverId, name: 'Lucas' },
          forbidden: { id: forbiddenId, name: 'Maria' },
        }),
      ]);
      expect(response.body.restrictions[0]).not.toHaveProperty('nameEncrypted');
      expect(response.body.restrictions[0].giver).not.toHaveProperty('nameEncrypted');
      expect(response.body.restrictions[0].forbidden).not.toHaveProperty('emailEncrypted');
    });

    it('returns 404 to another user', async () => {
      const groupId = cuid(1);
      addGroup(groupId, 'owner-2');

      const response = await request(app)
        .get(`/groups/${groupId}/restrictions`)
        .set('Cookie', authCookie('owner-1'));

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /groups/:groupId/restrictions/:restrictionId', () => {
    it('allows an owner to remove a restriction in DRAFT', async () => {
      const groupId = cuid(1);
      const giverId = cuid(10);
      const forbiddenId = cuid(11);
      addGroup(groupId, 'owner-1');
      addParticipant(giverId, groupId, 'Lucas');
      addParticipant(forbiddenId, groupId, 'Maria');
      const restriction = addRestriction(groupId, giverId, forbiddenId);

      const response = await request(app)
        .delete(`/groups/${groupId}/restrictions/${restriction.id}`)
        .set('Cookie', authCookie('owner-1'));

      expect(response.status).toBe(204);
      expect(restrictions.has(restriction.id)).toBe(false);
    });

    it('does not allow another user to remove a restriction', async () => {
      const groupId = cuid(1);
      const giverId = cuid(10);
      const forbiddenId = cuid(11);
      addGroup(groupId, 'owner-2');
      addParticipant(giverId, groupId, 'Lucas');
      addParticipant(forbiddenId, groupId, 'Maria');
      const restriction = addRestriction(groupId, giverId, forbiddenId);

      const response = await request(app)
        .delete(`/groups/${groupId}/restrictions/${restriction.id}`)
        .set('Cookie', authCookie('owner-1'));

      expect(response.status).toBe(404);
      expect(restrictions.has(restriction.id)).toBe(true);
    });

    it('does not remove a restriction from another group', async () => {
      const groupId = cuid(1);
      const otherGroupId = cuid(2);
      const giverId = cuid(10);
      const forbiddenId = cuid(11);
      addGroup(groupId, 'owner-1');
      addGroup(otherGroupId, 'owner-1');
      addParticipant(giverId, groupId, 'Lucas');
      addParticipant(forbiddenId, groupId, 'Maria');
      const restriction = addRestriction(otherGroupId, giverId, forbiddenId);

      const response = await request(app)
        .delete(`/groups/${groupId}/restrictions/${restriction.id}`)
        .set('Cookie', authCookie('owner-1'));

      expect(response.status).toBe(404);
      expect(restrictions.has(restriction.id)).toBe(true);
    });

    it('does not allow removal outside DRAFT', async () => {
      const groupId = cuid(1);
      const giverId = cuid(10);
      const forbiddenId = cuid(11);
      addGroup(groupId, 'owner-1', 'READY');
      addParticipant(giverId, groupId, 'Lucas');
      addParticipant(forbiddenId, groupId, 'Maria');
      const restriction = addRestriction(groupId, giverId, forbiddenId);

      const response = await request(app)
        .delete(`/groups/${groupId}/restrictions/${restriction.id}`)
        .set('Cookie', authCookie('owner-1'));

      expect(response.status).toBe(409);
      expect(restrictions.has(restriction.id)).toBe(true);
    });
  });
});
