import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  group: {
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
  name: string;
  status: 'DRAFT' | 'READY' | 'SORTEADO' | 'CANCELLED';
  createdAt: Date;
  updatedAt: Date;
};

const groups = new Map<string, StoredGroup>();
const groupId = (number: number): string => `c${number.toString().padStart(24, '0')}`;

const toPublicGroup = ({
  id,
  name,
  status,
  createdAt,
  updatedAt,
}: StoredGroup) => ({
  id,
  name,
  status,
  createdAt,
  updatedAt,
});

const authCookie = (userId: string): string =>
  `auth_token=${createAuthToken(userId)}`;

const addGroup = (
  id: string,
  ownerId: string,
  name: string,
  status: StoredGroup['status'] = 'DRAFT',
  createdAt = new Date(),
): StoredGroup => {
  const group = {
    id,
    ownerId,
    name,
    status,
    createdAt,
    updatedAt: createdAt,
  };

  groups.set(id, group);
  return group;
};

beforeEach(() => {
  groups.clear();
  prismaMock.group.create.mockImplementation(async ({ data }) => {
    const now = new Date();
    const group = addGroup(groupId(groups.size + 1), data.ownerId, data.name, data.status, now);

    return {
      id: group.id,
      name: group.name,
      status: group.status,
      createdAt: group.createdAt,
    };
  });
  prismaMock.group.findMany.mockImplementation(async ({ where }) =>
    [...groups.values()]
      .filter((group) => group.ownerId === where.ownerId)
      .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())
      .map(toPublicGroup),
  );
  prismaMock.group.findFirst.mockImplementation(async ({ where }) => {
    const group = groups.get(where.id);

    if (!group || group.ownerId !== where.ownerId) {
      return null;
    }

    return toPublicGroup(group);
  });
  prismaMock.group.update.mockImplementation(async ({ where, data }) => {
    const group = groups.get(where.id);

    if (!group) {
      throw new Error('Group not found.');
    }

    group.name = data.name;
    group.updatedAt = new Date();

    return toPublicGroup(group);
  });
  prismaMock.group.delete.mockImplementation(async ({ where }) => {
    const group = groups.get(where.id);

    if (!group) {
      throw new Error('Group not found.');
    }

    groups.delete(where.id);
    return group;
  });
});

describe('groups', () => {
  describe('POST /groups', () => {
    it('creates a DRAFT group for the authenticated user', async () => {
      const response = await request(app)
        .post('/groups')
        .set('Cookie', authCookie('owner-1'))
        .send({ name: '  Família 2026  ', ownerId: 'other-user' });

      expect(response.status).toBe(201);
      expect(response.body.group).toMatchObject({
        name: 'Família 2026',
        status: 'DRAFT',
      });
      expect(groups.get(response.body.group.id)?.ownerId).toBe('owner-1');
    });

    it('rejects unauthenticated requests', async () => {
      const response = await request(app).post('/groups').send({ name: 'Grupo' });

      expect(response.status).toBe(401);
    });

    it('rejects an invalid name', async () => {
      const response = await request(app)
        .post('/groups')
        .set('Cookie', authCookie('owner-1'))
        .send({ name: '   ' });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /groups', () => {
    it('returns only the authenticated user groups, ordered by newest first', async () => {
      addGroup(groupId(1), 'owner-1', 'Older', 'DRAFT', new Date('2026-01-01'));
      addGroup(groupId(2), 'owner-1', 'Newer', 'DRAFT', new Date('2026-02-01'));
      addGroup(groupId(3), 'owner-2', 'Other user');

      const response = await request(app)
        .get('/groups')
        .set('Cookie', authCookie('owner-1'));

      expect(response.status).toBe(200);
      expect(response.body.groups.map((group: { id: string }) => group.id)).toEqual([
        groupId(2),
        groupId(1),
      ]);
    });
  });

  describe('GET /groups/:groupId', () => {
    it('allows the owner to get a group', async () => {
      const id = groupId(1);
      addGroup(id, 'owner-1', 'Grupo');

      const response = await request(app)
        .get(`/groups/${id}`)
        .set('Cookie', authCookie('owner-1'));

      expect(response.status).toBe(200);
      expect(response.body.group).toMatchObject({ id, name: 'Grupo' });
    });

    it('returns 404 for another user group and for a missing group', async () => {
      const otherUserGroupId = groupId(1);
      addGroup(otherUserGroupId, 'owner-2', 'Private group');

      const otherUserResponse = await request(app)
        .get(`/groups/${otherUserGroupId}`)
        .set('Cookie', authCookie('owner-1'));
      const missingGroupResponse = await request(app)
        .get(`/groups/${groupId(2)}`)
        .set('Cookie', authCookie('owner-1'));

      expect(otherUserResponse.status).toBe(404);
      expect(missingGroupResponse.status).toBe(404);
    });
  });

  describe('PATCH /groups/:groupId', () => {
    it('allows the owner to rename a DRAFT group', async () => {
      const id = groupId(1);
      addGroup(id, 'owner-1', 'Old name');

      const response = await request(app)
        .patch(`/groups/${id}`)
        .set('Cookie', authCookie('owner-1'))
        .send({ name: '  New name  ', status: 'SORTEADO' });

      expect(response.status).toBe(200);
      expect(response.body.group).toMatchObject({ id, name: 'New name', status: 'DRAFT' });
    });

    it('returns 404 when another user tries to rename a group', async () => {
      const id = groupId(1);
      addGroup(id, 'owner-2', 'Private group');

      const response = await request(app)
        .patch(`/groups/${id}`)
        .set('Cookie', authCookie('owner-1'))
        .send({ name: 'New name' });

      expect(response.status).toBe(404);
    });

    it('rejects renaming a group outside DRAFT', async () => {
      const id = groupId(1);
      addGroup(id, 'owner-1', 'Sorteado group', 'SORTEADO');

      const response = await request(app)
        .patch(`/groups/${id}`)
        .set('Cookie', authCookie('owner-1'))
        .send({ name: 'New name' });

      expect(response.status).toBe(409);
    });
  });

  describe('DELETE /groups/:groupId', () => {
    it('allows the owner to delete a DRAFT group', async () => {
      const id = groupId(1);
      addGroup(id, 'owner-1', 'Draft group');

      const response = await request(app)
        .delete(`/groups/${id}`)
        .set('Cookie', authCookie('owner-1'));

      expect(response.status).toBe(204);
      expect(groups.has(id)).toBe(false);
    });

    it('returns 404 when another user tries to delete a group', async () => {
      const id = groupId(1);
      addGroup(id, 'owner-2', 'Private group');

      const response = await request(app)
        .delete(`/groups/${id}`)
        .set('Cookie', authCookie('owner-1'));

      expect(response.status).toBe(404);
      expect(groups.has(id)).toBe(true);
    });

    it('rejects deleting a group outside DRAFT', async () => {
      const id = groupId(1);
      addGroup(id, 'owner-1', 'Cancelled group', 'CANCELLED');

      const response = await request(app)
        .delete(`/groups/${id}`)
        .set('Cookie', authCookie('owner-1'));

      expect(response.status).toBe(409);
      expect(groups.has(id)).toBe(true);
    });
  });
});
