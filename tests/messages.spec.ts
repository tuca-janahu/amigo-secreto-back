import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  anonymousMessage: {
    create: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  group: {
    findFirst: vi.fn(),
  },
  participantAccess: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));

import { createAuthToken } from '../src/lib/auth-token.js';
import { app } from '../src/app.js';
import { hashParticipantAccessToken } from '../src/modules/participant-access/participant-access.tokens.js';
import { messageCreationRateLimiter } from '../src/middlewares/security.js';

type StoredGroup = {
  id: string;
  ownerId: string;
  name: string;
  status: 'DRAFT' | 'READY' | 'SORTEADO' | 'CANCELLED';
};

type StoredAccess = {
  id: string;
  groupId: string;
  tokenHash: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  firstAccessedAt: Date | null;
};

type StoredMessage = {
  id: string;
  groupId: string;
  content: string;
  createdAt: Date;
  deletedAt: Date | null;
};

const groups = new Map<string, StoredGroup>();
const accesses = new Map<string, StoredAccess>();
const messages = new Map<string, StoredMessage>();
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

const addAccess = (token: string, groupId: string): StoredAccess => {
  const access = {
    id: `access-${token}`,
    groupId,
    tokenHash: hashParticipantAccessToken(token),
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    firstAccessedAt: null,
  };
  accesses.set(access.id, access);
  return access;
};

const addMessage = (
  id: string,
  groupId: string,
  content: string,
  deletedAt: Date | null = null,
): StoredMessage => {
  const message = { id, groupId, content, createdAt: new Date(), deletedAt };
  messages.set(id, message);
  return message;
};

const toPublicMessage = ({ id, content, createdAt }: StoredMessage) => ({
  id,
  content,
  createdAt,
});

beforeEach(() => {
  messageCreationRateLimiter.resetKey('127.0.0.1');
  vi.clearAllMocks();
  groups.clear();
  accesses.clear();
  messages.clear();

  prismaMock.group.findFirst.mockImplementation(async ({ where }) => {
    const group = groups.get(where.id);
    return group?.ownerId === where.ownerId ? group : null;
  });
  prismaMock.participantAccess.findUnique.mockImplementation(async ({ where }) => {
    const access = [...accesses.values()].find(
      ({ tokenHash }) => tokenHash === where.tokenHash,
    );

    if (!access) {
      return null;
    }

    const group = groups.get(access.groupId);

    if (!group) {
      return null;
    }

    return {
      ...access,
      participant: { group },
    };
  });
  prismaMock.participantAccess.updateMany.mockImplementation(async ({ where, data }) => {
    const access = accesses.get(where.id);

    if (!access || (where.firstAccessedAt === null && access.firstAccessedAt !== null)) {
      return { count: 0 };
    }

    Object.assign(access, data);
    return { count: 1 };
  });
  prismaMock.anonymousMessage.findMany.mockImplementation(async ({ where }) =>
    [...messages.values()]
      .filter(
        (message) => message.groupId === where.groupId && message.deletedAt === null,
      )
      .sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime())
      .map(toPublicMessage),
  );
  prismaMock.anonymousMessage.create.mockImplementation(async ({ data }) => {
    const message = addMessage(cuid(messages.size + 100), data.groupId, data.content);
    return toPublicMessage(message);
  });
  prismaMock.anonymousMessage.updateMany.mockImplementation(async ({ where, data }) => {
    const message = messages.get(where.id);

    if (
      !message ||
      message.groupId !== where.groupId ||
      (where.deletedAt === null && message.deletedAt !== null)
    ) {
      return { count: 0 };
    }

    message.deletedAt = data.deletedAt;
    return { count: 1 };
  });
});

describe('participant anonymous messages', () => {
  it('lists only non-deleted messages from the token group', async () => {
    const firstGroupId = cuid(1);
    const secondGroupId = cuid(2);
    addGroup(firstGroupId, 'owner-1');
    addGroup(secondGroupId, 'owner-2');
    addAccess('valid-token', firstGroupId);
    addMessage(cuid(10), firstGroupId, 'First message');
    addMessage(cuid(11), firstGroupId, 'Deleted message', new Date());
    addMessage(cuid(12), secondGroupId, 'Other group message');

    const response = await request(app).get(
      '/public/participant-access/valid-token/messages',
    );

    expect(response.status).toBe(200);
    expect(response.body.messages).toEqual([
      expect.objectContaining({ id: cuid(10), content: 'First message' }),
    ]);
    expect(response.body.messages[0]).not.toHaveProperty('participantId');
    expect(response.body.messages[0]).not.toHaveProperty('authorId');
  });

  it.each([
    ['missing-token', (access: StoredAccess) => accesses.delete(access.id)],
    ['expired-token', (access: StoredAccess) => {
      access.expiresAt = new Date(Date.now() - 1);
    }],
    ['revoked-token', (access: StoredAccess) => {
      access.revokedAt = new Date();
    }],
  ])('rejects a %s token', async (token, changeAccess) => {
    const groupId = cuid(1);
    addGroup(groupId, 'owner-1');
    const access = addAccess(token, groupId);
    changeAccess(access);

    const response = await request(app).get(
      `/public/participant-access/${token}/messages`,
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      message: 'Acesso do participante não encontrado.',
    });
  });

  it.each(['DRAFT', 'CANCELLED'] as const)(
    'blocks public messages for a %s group',
    async (status) => {
      const groupId = cuid(1);
      addGroup(groupId, 'owner-1', status);
      addAccess(`${status.toLowerCase()}-token`, groupId);

      const response = await request(app).get(
        `/public/participant-access/${status.toLowerCase()}-token/messages`,
      );

      expect(response.status).toBe(404);
    },
  );

  it('creates a trimmed anonymous message without persisting author data', async () => {
    const groupId = cuid(1);
    addGroup(groupId, 'owner-1');
    addAccess('post-token', groupId);

    const response = await request(app)
      .post('/public/participant-access/post-token/messages')
      .send({ content: '  Does my secret friend like chocolate?  ' });

    expect(response.status).toBe(201);
    expect(response.body.message).toMatchObject({
      content: 'Does my secret friend like chocolate?',
    });
    const storedMessage = messages.get(response.body.message.id);
    expect(storedMessage).toEqual(
      expect.objectContaining({
        groupId,
        content: 'Does my secret friend like chocolate?',
      }),
    );
    expect(storedMessage).not.toHaveProperty('participantId');
    expect(storedMessage).not.toHaveProperty('participantAccessId');
    expect(storedMessage).not.toHaveProperty('tokenHash');
    expect(storedMessage).not.toHaveProperty('userId');
    expect(storedMessage).not.toHaveProperty('authorId');
  });

  it('rejects empty and oversized messages', async () => {
    const groupId = cuid(1);
    addGroup(groupId, 'owner-1');
    addAccess('validation-token', groupId);

    const emptyResponse = await request(app)
      .post('/public/participant-access/validation-token/messages')
      .send({ content: '   ' });
    const oversizedResponse = await request(app)
      .post('/public/participant-access/validation-token/messages')
      .send({ content: 'a'.repeat(501) });

    expect(emptyResponse.status).toBe(400);
    expect(oversizedResponse.status).toBe(400);
    expect(messages.size).toBe(0);
  });

  it('limita a publicação a vinte mensagens por IP em quinze minutos', async () => {
    const groupId = cuid(1);
    addGroup(groupId, 'owner-1');
    addAccess('spam-token', groupId);

    const responses = [];

    for (let index = 0; index < 21; index += 1) {
      responses.push(
        await request(app)
          .post('/public/participant-access/spam-token/messages')
          .send({ content: `Mensagem ${index}` }),
      );
    }

    expect(responses.slice(0, 20).every(({ status }) => status === 201)).toBe(true);
    expect(responses[20].status).toBe(429);
    expect(messages.size).toBe(20);
  });
});

describe('owner anonymous messages', () => {
  it('lists only non-deleted messages from the owner group', async () => {
    const firstGroupId = cuid(1);
    const secondGroupId = cuid(2);
    addGroup(firstGroupId, 'owner-1');
    addGroup(secondGroupId, 'owner-2');
    addMessage(cuid(10), firstGroupId, 'Own message');
    addMessage(cuid(11), firstGroupId, 'Deleted message', new Date());
    addMessage(cuid(12), secondGroupId, 'Other group message');

    const response = await request(app)
      .get(`/groups/${firstGroupId}/messages`)
      .set('Cookie', authCookie('owner-1'));

    expect(response.status).toBe(200);
    expect(response.body.messages).toEqual([
      expect.objectContaining({ id: cuid(10), content: 'Own message' }),
    ]);
  });

  it('rejects another owner from listing messages', async () => {
    const groupId = cuid(1);
    addGroup(groupId, 'owner-2');

    const response = await request(app)
      .get(`/groups/${groupId}/messages`)
      .set('Cookie', authCookie('owner-1'));

    expect(response.status).toBe(404);
  });

  it('soft-deletes a message owned by the authenticated owner', async () => {
    const groupId = cuid(1);
    const message = addMessage(cuid(10), groupId, 'Remove me');
    addGroup(groupId, 'owner-1');

    const response = await request(app)
      .delete(`/groups/${groupId}/messages/${message.id}`)
      .set('Cookie', authCookie('owner-1'));

    expect(response.status).toBe(204);
    expect(message.deletedAt).toBeInstanceOf(Date);
  });

  it('rejects deletion by another user and messages from another group', async () => {
    const firstGroupId = cuid(1);
    const secondGroupId = cuid(2);
    addGroup(firstGroupId, 'owner-1');
    addGroup(secondGroupId, 'owner-2');
    const ownMessage = addMessage(cuid(10), firstGroupId, 'Own message');
    const otherMessage = addMessage(cuid(11), secondGroupId, 'Other message');

    const otherUserResponse = await request(app)
      .delete(`/groups/${firstGroupId}/messages/${ownMessage.id}`)
      .set('Cookie', authCookie('owner-2'));
    const otherGroupResponse = await request(app)
      .delete(`/groups/${firstGroupId}/messages/${otherMessage.id}`)
      .set('Cookie', authCookie('owner-1'));

    expect(otherUserResponse.status).toBe(404);
    expect(otherGroupResponse.status).toBe(404);
    expect(ownMessage.deletedAt).toBeNull();
    expect(otherMessage.deletedAt).toBeNull();
  });
});
