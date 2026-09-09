import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  group: {
    findFirst: vi.fn(),
  },
  participant: {
    create: vi.fn(),
    delete: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));

import { createAuthToken } from '../src/lib/auth-token.js';
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
  emailEncrypted: string;
  emailLookupHash: string;
  createdAt: Date;
  updatedAt: Date;
};

const groups = new Map<string, StoredGroup>();
const participants = new Map<string, StoredParticipant>();
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

const addParticipant = (participant: StoredParticipant): StoredParticipant => {
  participants.set(participant.id, participant);
  return participant;
};

beforeEach(() => {
  groups.clear();
  participants.clear();

  prismaMock.group.findFirst.mockImplementation(async ({ where }) => {
    const group = groups.get(where.id);
    return group?.ownerId === where.ownerId ? group : null;
  });
  prismaMock.participant.findFirst.mockImplementation(async ({ where }) => {
    const participant = [...participants.values()].find((storedParticipant) => {
      if (storedParticipant.groupId !== where.groupId) {
        return false;
      }

      return where.id
        ? storedParticipant.id === where.id
        : storedParticipant.emailLookupHash === where.emailLookupHash;
    });

    return participant ?? null;
  });
  prismaMock.participant.findMany.mockImplementation(async ({ where }) =>
    [...participants.values()]
      .filter((participant) => participant.groupId === where.groupId)
      .sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime()),
  );
  prismaMock.participant.create.mockImplementation(async ({ data }) => {
    const now = new Date();
    const participant = addParticipant({
      id: cuid(participants.size + 100),
      ...data,
      createdAt: now,
      updatedAt: now,
    });

    return participant;
  });
  prismaMock.participant.update.mockImplementation(async ({ where, data }) => {
    const participant = participants.get(where.id);

    if (!participant) {
      throw new Error('Participant not found.');
    }

    Object.assign(participant, data, { updatedAt: new Date() });
    return participant;
  });
  prismaMock.participant.delete.mockImplementation(async ({ where }) => {
    const participant = participants.get(where.id);

    if (!participant) {
      throw new Error('Participant not found.');
    }

    participants.delete(where.id);
    return participant;
  });
});

describe('participants', () => {
  describe('POST /groups/:groupId/participants', () => {
    it('allows an owner to create a protected participant in a DRAFT group', async () => {
      const groupId = cuid(1);
      addGroup(groupId, 'owner-1');

      const response = await request(app)
        .post(`/groups/${groupId}/participants`)
        .set('Cookie', authCookie('owner-1'))
        .send({ name: '  Lucas Silva  ', email: '  Lucas@Email.com  ' });

      expect(response.status).toBe(201);
      expect(response.body.participant).toMatchObject({
        name: 'Lucas Silva',
        email: 'lucas@email.com',
      });
      expect(response.body.participant).not.toHaveProperty('nameEncrypted');
      expect(response.body.participant).not.toHaveProperty('emailEncrypted');
      expect(response.body.participant).not.toHaveProperty('emailLookupHash');

      const storedParticipant = participants.get(response.body.participant.id);
      expect(storedParticipant?.nameEncrypted).not.toContain('Lucas Silva');
      expect(storedParticipant?.emailEncrypted).not.toContain('lucas@email.com');
      expect(storedParticipant?.emailLookupHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('prevents duplicate emails in the same group but allows them in another group', async () => {
      const firstGroupId = cuid(1);
      const secondGroupId = cuid(2);
      addGroup(firstGroupId, 'owner-1');
      addGroup(secondGroupId, 'owner-1');

      await request(app)
        .post(`/groups/${firstGroupId}/participants`)
        .set('Cookie', authCookie('owner-1'))
        .send({ name: 'Lucas', email: 'lucas@email.com' });

      const duplicateResponse = await request(app)
        .post(`/groups/${firstGroupId}/participants`)
        .set('Cookie', authCookie('owner-1'))
        .send({ name: 'Another Lucas', email: ' LUCAS@email.com ' });
      const otherGroupResponse = await request(app)
        .post(`/groups/${secondGroupId}/participants`)
        .set('Cookie', authCookie('owner-1'))
        .send({ name: 'Lucas', email: 'lucas@email.com' });

      expect(duplicateResponse.status).toBe(409);
      expect(otherGroupResponse.status).toBe(201);
    });

    it('returns 404 when another user tries to add a participant', async () => {
      const groupId = cuid(1);
      addGroup(groupId, 'owner-2');

      const response = await request(app)
        .post(`/groups/${groupId}/participants`)
        .set('Cookie', authCookie('owner-1'))
        .send({ name: 'Lucas', email: 'lucas@email.com' });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /groups/:groupId/participants', () => {
    it('returns decrypted participants to the owner in creation order', async () => {
      const groupId = cuid(1);
      addGroup(groupId, 'owner-1');

      await request(app)
        .post(`/groups/${groupId}/participants`)
        .set('Cookie', authCookie('owner-1'))
        .send({ name: 'First', email: 'first@email.com' });
      await request(app)
        .post(`/groups/${groupId}/participants`)
        .set('Cookie', authCookie('owner-1'))
        .send({ name: 'Second', email: 'second@email.com' });

      const response = await request(app)
        .get(`/groups/${groupId}/participants`)
        .set('Cookie', authCookie('owner-1'));

      expect(response.status).toBe(200);
      expect(response.body.participants.map((participant: { name: string }) => participant.name)).toEqual([
        'First',
        'Second',
      ]);
      expect(response.body.participants[0]).not.toHaveProperty('emailEncrypted');
    });

    it('returns 404 to another user', async () => {
      const groupId = cuid(1);
      addGroup(groupId, 'owner-2');

      const response = await request(app)
        .get(`/groups/${groupId}/participants`)
        .set('Cookie', authCookie('owner-1'));

      expect(response.status).toBe(404);
    });
  });

  describe('GET /groups/:groupId/participants/:participantId', () => {
    it('returns a decrypted participant to its group owner', async () => {
      const groupId = cuid(1);
      addGroup(groupId, 'owner-1');
      const created = await request(app)
        .post(`/groups/${groupId}/participants`)
        .set('Cookie', authCookie('owner-1'))
        .send({ name: 'Lucas', email: 'lucas@email.com' });

      const response = await request(app)
        .get(`/groups/${groupId}/participants/${created.body.participant.id}`)
        .set('Cookie', authCookie('owner-1'));

      expect(response.status).toBe(200);
      expect(response.body.participant).toMatchObject({
        name: 'Lucas',
        email: 'lucas@email.com',
      });
      expect(response.body.participant).not.toHaveProperty('emailLookupHash');
    });

    it('does not expose a participant from another group', async () => {
      const firstGroupId = cuid(1);
      const secondGroupId = cuid(2);
      addGroup(firstGroupId, 'owner-1');
      addGroup(secondGroupId, 'owner-1');

      const created = await request(app)
        .post(`/groups/${firstGroupId}/participants`)
        .set('Cookie', authCookie('owner-1'))
        .send({ name: 'Lucas', email: 'lucas@email.com' });

      const response = await request(app)
        .get(`/groups/${secondGroupId}/participants/${created.body.participant.id}`)
        .set('Cookie', authCookie('owner-1'));

      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /groups/:groupId/participants/:participantId', () => {
    it('updates name and email independently with fresh ciphertexts', async () => {
      const groupId = cuid(1);
      addGroup(groupId, 'owner-1');
      const created = await request(app)
        .post(`/groups/${groupId}/participants`)
        .set('Cookie', authCookie('owner-1'))
        .send({ name: 'Lucas', email: 'lucas@email.com' });
      const participantId = created.body.participant.id;
      const oldParticipant = participants.get(participantId);
      const oldNameEncrypted = oldParticipant?.nameEncrypted;
      const oldEmailEncrypted = oldParticipant?.emailEncrypted;

      const nameResponse = await request(app)
        .patch(`/groups/${groupId}/participants/${participantId}`)
        .set('Cookie', authCookie('owner-1'))
        .send({ name: 'New Lucas' });

      expect(nameResponse.status).toBe(200);
      expect(nameResponse.body.participant).toMatchObject({
        id: participantId,
        name: 'New Lucas',
        email: 'lucas@email.com',
      });
      expect(participants.get(participantId)?.nameEncrypted).not.toBe(
        oldNameEncrypted,
      );
      expect(participants.get(participantId)?.emailEncrypted).toBe(
        oldEmailEncrypted,
      );

      const nameEncryptedAfterNameUpdate =
        participants.get(participantId)?.nameEncrypted;
      const emailResponse = await request(app)
        .patch(`/groups/${groupId}/participants/${participantId}`)
        .set('Cookie', authCookie('owner-1'))
        .send({ email: 'new@email.com' });

      expect(emailResponse.status).toBe(200);
      expect(emailResponse.body.participant).toMatchObject({
        id: participantId,
        name: 'New Lucas',
        email: 'new@email.com',
      });
      expect(participants.get(participantId)?.nameEncrypted).toBe(
        nameEncryptedAfterNameUpdate,
      );
      expect(participants.get(participantId)?.emailEncrypted).not.toBe(
        oldEmailEncrypted,
      );
    });

    it('prevents duplicate email updates and edits outside DRAFT', async () => {
      const groupId = cuid(1);
      const group = addGroup(groupId, 'owner-1');
      const first = await request(app)
        .post(`/groups/${groupId}/participants`)
        .set('Cookie', authCookie('owner-1'))
        .send({ name: 'First', email: 'first@email.com' });
      const second = await request(app)
        .post(`/groups/${groupId}/participants`)
        .set('Cookie', authCookie('owner-1'))
        .send({ name: 'Second', email: 'second@email.com' });

      const duplicateResponse = await request(app)
        .patch(`/groups/${groupId}/participants/${second.body.participant.id}`)
        .set('Cookie', authCookie('owner-1'))
        .send({ email: 'first@email.com' });

      group.status = 'READY';
      const statusResponse = await request(app)
        .patch(`/groups/${groupId}/participants/${first.body.participant.id}`)
        .set('Cookie', authCookie('owner-1'))
        .send({ name: 'Blocked' });

      expect(duplicateResponse.status).toBe(409);
      expect(statusResponse.status).toBe(409);
    });
  });

  describe('DELETE /groups/:groupId/participants/:participantId', () => {
    it('removes a participant in DRAFT', async () => {
      const groupId = cuid(1);
      addGroup(groupId, 'owner-1');
      const created = await request(app)
        .post(`/groups/${groupId}/participants`)
        .set('Cookie', authCookie('owner-1'))
        .send({ name: 'Lucas', email: 'lucas@email.com' });

      const response = await request(app)
        .delete(`/groups/${groupId}/participants/${created.body.participant.id}`)
        .set('Cookie', authCookie('owner-1'));

      expect(response.status).toBe(204);
      expect(participants.has(created.body.participant.id)).toBe(false);
    });

    it('blocks deletion outside DRAFT and from another user', async () => {
      const groupId = cuid(1);
      const group = addGroup(groupId, 'owner-1');
      const created = await request(app)
        .post(`/groups/${groupId}/participants`)
        .set('Cookie', authCookie('owner-1'))
        .send({ name: 'Lucas', email: 'lucas@email.com' });

      group.status = 'DRAWN';
      const statusResponse = await request(app)
        .delete(`/groups/${groupId}/participants/${created.body.participant.id}`)
        .set('Cookie', authCookie('owner-1'));
      const otherUserResponse = await request(app)
        .delete(`/groups/${groupId}/participants/${created.body.participant.id}`)
        .set('Cookie', authCookie('owner-2'));

      expect(statusResponse.status).toBe(409);
      expect(otherUserResponse.status).toBe(404);
      expect(participants.has(created.body.participant.id)).toBe(true);
    });
  });
});
