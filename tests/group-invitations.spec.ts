import { GroupStatus, Prisma } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendGroupJoinEmail = vi.hoisted(() => vi.fn());
vi.mock('../src/modules/group-invitations/group-invitations.email.js', () => ({ sendGroupJoinEmail }));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  user: { findUnique: vi.fn() },
  group: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  groupInvitation: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  participant: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  restriction: { findMany: vi.fn() },
  assignment: { createMany: vi.fn() },
  participantAccess: { createMany: vi.fn() },
  auditEvent: { create: vi.fn() },
}));
vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));

import { app } from '../src/app.js';
import { createAuthToken } from '../src/lib/auth-token.js';
import {
  createEmailLookupHash,
  decryptData,
  encryptData,
} from '../src/lib/data-protection.js';
import {
  groupInvitationJoinRateLimiter,
  groupInvitationPreviewRateLimiter,
} from '../src/middlewares/security.js';
import {
  deleteGroupInvitation,
  joinGroupInvitation,
  replaceGroupInvitation,
} from '../src/modules/group-invitations/group-invitations.service.js';
import { hashGroupInvitationToken } from '../src/modules/group-invitations/group-invitations.tokens.js';
import { sortearGrupo } from '../src/modules/sorteio/sorteio.service.js';

const groupId = 'c000000000000000000000001';
const ownerId = 'owner';
const userId = 'guest';
const ownerPath = `/groups/${groupId}/invitation`;
const cookie = (id = ownerId) => `auth_token=${createAuthToken(id)}`;
const tokenFrom = (url: string) => new URL(url).pathname.split('/').at(-1)!;
const publicPath = (token: string) => `/public/group-invitations/${token}`;

type StoredParticipant = {
  id: string;
  groupId: string;
  userId: string | null;
  nameEncrypted: string;
  emailEncrypted: string;
  emailLookupHash: string;
};
type StoredInvitation = {
  id: string;
  groupId: string;
  tokenHash: string;
  tokenEncrypted: string;
  createdAt: Date;
  updatedAt: Date;
};
let group: {
  id: string;
  name: string;
  ownerId: string;
  status: GroupStatus;
  createdAt: Date;
  updatedAt: Date;
  sorteadoAt: Date | null;
};
let invitation: StoredInvitation | null;
const participants = new Map<string, StoredParticipant>();
const users = new Map<string, { id: string; name: string; email: string }>();
const assignments = new Map<string, unknown>();
let lockTail = Promise.resolve();

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const addParticipant = (
  id: string,
  email: string,
  linkedUserId: string | null = null,
) => {
  const participant: StoredParticipant = {
    id,
    groupId,
    userId: linkedUserId,
    nameEncrypted: encryptData(`Nome ${id}`),
    emailEncrypted: encryptData(email),
    emailLookupHash: createEmailLookupHash(email),
  };
  participants.set(id, participant);
  return participant;
};

beforeEach(() => {
  vi.resetAllMocks();
  groupInvitationJoinRateLimiter.resetKey('127.0.0.1');
  groupInvitationPreviewRateLimiter.resetKey('127.0.0.1');
  group = {
    id: groupId,
    name: 'Amigos',
    ownerId,
    status: GroupStatus.DRAFT,
    createdAt: new Date(),
    updatedAt: new Date(),
    sorteadoAt: null,
  };
  invitation = null;
  participants.clear();
  assignments.clear();
  users.clear();
  users.set(ownerId, {
    id: ownerId,
    name: 'Organizador',
    email: 'owner@example.com',
  });
  users.set(userId, {
    id: userId,
    name: 'Convidado',
    email: ' Guest@Example.com ',
  });
  lockTail = Promise.resolve();

  prismaMock.user.findUnique.mockImplementation(
    async ({ where }) => users.get(where.id) ?? null,
  );
  prismaMock.group.findFirst.mockImplementation(async ({ where }) =>
    where.id === group.id && where.ownerId === group.ownerId
      ? { ...group }
      : null,
  );
  prismaMock.group.findMany.mockImplementation(async ({ where }) => {
    const id = where.OR[0].ownerId;
    const linked = [...participants.values()].filter(
      (participant) => participant.userId === id,
    );
    return group.ownerId === id || linked.length > 0
      ? [
          {
            ...group,
            participants: linked.map((participant) => ({
              ...participant,
              accesses: [],
            })),
          },
        ]
      : [];
  });
  prismaMock.group.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.id !== group.id || where.status !== group.status)
      return { count: 0 };
    Object.assign(group, data);
    return { count: 1 };
  });
  prismaMock.groupInvitation.findUnique.mockImplementation(
    async ({ where }) => {
      if (
        !invitation ||
        (where.tokenHash && where.tokenHash !== invitation.tokenHash) ||
        (where.groupId && where.groupId !== invitation.groupId)
      )
        return null;
      return { ...invitation, group: { ...group, owner: { email: users.get(ownerId)!.email } } };
    },
  );
  prismaMock.groupInvitation.findFirst.mockImplementation(async ({ where }) =>
    invitation?.groupId === where.groupId &&
    invitation?.tokenHash === where.tokenHash
      ? { ...invitation }
      : null,
  );
  prismaMock.groupInvitation.upsert.mockImplementation(
    async ({ create, update }) => {
      invitation = invitation
        ? { ...invitation, ...update, updatedAt: new Date() }
        : {
            id: 'invitation',
            ...create,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
      return { ...invitation };
    },
  );
  prismaMock.groupInvitation.deleteMany.mockImplementation(async () => {
    const count = invitation ? 1 : 0;
    invitation = null;
    return { count };
  });
  prismaMock.participant.findUnique.mockImplementation(async ({ where }) => {
    const identity = where.groupId_userId ?? where.groupId_emailLookupHash;
    return (
      [...participants.values()].find(
        (participant) =>
          participant.groupId === identity.groupId &&
          (identity.userId
            ? participant.userId === identity.userId
            : participant.emailLookupHash === identity.emailLookupHash),
      ) ?? null
    );
  });
  prismaMock.participant.findMany.mockImplementation(async () => [
    ...participants.values(),
  ]);
  prismaMock.participant.create.mockImplementation(async ({ data }) => {
    const participant = { id: `participant-${participants.size}`, ...data };
    participants.set(participant.id, participant);
    return participant;
  });
  prismaMock.participant.updateMany.mockImplementation(
    async ({ where, data }) => {
      const participant = participants.get(where.id);
      if (
        !participant ||
        participant.userId !== where.userId ||
        participant.emailLookupHash !== where.emailLookupHash
      )
        return { count: 0 };
      Object.assign(participant, data);
      return { count: 1 };
    },
  );
  prismaMock.restriction.findMany.mockResolvedValue([]);
  prismaMock.assignment.createMany.mockImplementation(async ({ data }) => {
    for (const assignment of data)
      assignments.set(assignment.participantId, assignment);
    return { count: data.length };
  });

  // Model the group row lock at UPDATE, rather than serializing whole transactions:
  // initial reads can overlap and must be revalidated after waiting for the lock.
  prismaMock.$transaction.mockImplementation(async (callback) => {
    let release: (() => void) | undefined;
    let snapshot:
      | {
          group: typeof group;
          invitation: typeof invitation;
          participants: Array<[string, StoredParticipant]>;
          assignments: Array<[string, unknown]>;
        }
      | undefined;
    const transaction = {
      ...prismaMock,
      group: {
        ...prismaMock.group,
        updateMany: async (args: unknown) => {
          if (!release) {
            const previous = lockTail;
            lockTail = new Promise<void>((done) => {
              release = done;
            });
            await previous;
            snapshot = structuredClone({
              group,
              invitation,
              participants: [...participants],
              assignments: [...assignments],
            });
          }
          return prismaMock.group.updateMany(args);
        },
      },
    };
    try {
      return await callback(transaction);
    } catch (error) {
      if (snapshot) {
        group = snapshot.group;
        invitation = snapshot.invitation;
        participants.clear();
        snapshot.participants.forEach(([id, participant]) =>
          participants.set(id, participant),
        );
        assignments.clear();
        snapshot.assignments.forEach(([id, assignment]) =>
          assignments.set(id, assignment),
        );
      }
      throw error;
    } finally {
      release?.();
    }
  });
});

const issueToken = async () =>
  tokenFrom((await replaceGroupInvitation(groupId, ownerId)).url);

describe('group invitation management', () => {
  it('returns null until generated and recovers the same protected link for its owner', async () => {
    const absent = await request(app).get(ownerPath).set('Cookie', cookie());
    expect(absent.body).toEqual({ invitation: null });
    const created = await request(app).post(ownerPath).set('Cookie', cookie());
    expect(created.status).toBe(200);
    const token = tokenFrom(created.body.invitation.url);
    expect(created.body.invitation.url).toBe(
      `http://localhost:5173/invite/${token}`,
    );
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invitation?.tokenHash).toBe(hashGroupInvitationToken(token));
    expect(invitation?.tokenEncrypted).not.toContain(token);
    expect(decryptData(invitation!.tokenEncrypted)).toBe(token);
    expect(invitation).not.toHaveProperty('token');
    expect(created.body.invitation).not.toHaveProperty('tokenHash');
    expect(created.body.invitation).not.toHaveProperty('tokenEncrypted');
    const retrieved = await request(app).get(ownerPath).set('Cookie', cookie());
    expect(retrieved.status).toBe(200);
    expect(retrieved.body).toEqual(created.body);
    expect(retrieved.headers['cache-control']).toBe('no-store');
  });

  it('replaces the link, invalidates its predecessor and previews only the group name', async () => {
    const old = await issueToken();
    const token = await issueToken();
    expect(token).not.toBe(old);
    expect((await request(app).get(publicPath(old))).status).toBe(404);
    const preview = await request(app).get(publicPath(token));
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual({ group: { name: 'Amigos' } });
    expect(preview.headers['cache-control']).toBe('no-store');
    expect(participants.size).toBe(0);
    const oldJoin = await request(app)
      .post(`${publicPath(old)}/join`)
      .set('Cookie', cookie(userId));
    expect(oldJoin.status).toBe(404);
  });

  it('identifies the owner only for their own authenticated invitation without joining on GET', async () => {
    const token = await issueToken();
    const owned = await request(app)
      .get(publicPath(token))
      .set('Cookie', cookie());
    expect(owned.status).toBe(200);
    expect(owned.body).toEqual({
      group: { name: 'Amigos' },
      ownerGroupId: groupId,
    });
    expect(owned.headers['cache-control']).toBe('no-store');

    for (const authCookie of [cookie(userId), 'auth_token=invalid']) {
      const other = await request(app)
        .get(publicPath(token))
        .set('Cookie', authCookie);
      expect(other.status).toBe(200);
      expect(other.body).toEqual({ group: { name: 'Amigos' } });
    }
    expect(participants.size).toBe(0);
  });

  it('revokes idempotently and can generate a new invitation afterwards', async () => {
    const token = await issueToken();
    for (let i = 0; i < 2; i++) {
      expect(
        (await request(app).delete(ownerPath).set('Cookie', cookie())).status,
      ).toBe(204);
    }
    expect(
      (await request(app).get(ownerPath).set('Cookie', cookie())).body,
    ).toEqual({ invitation: null });
    expect((await request(app).get(publicPath(token))).status).toBe(404);
    expect(await issueToken()).not.toBe(token);
  });

  it.each(['get', 'post', 'delete'] as const)(
    'protects owner %s endpoints and error responses',
    async (method) => {
      const unauthenticated = await request(app)[method](ownerPath);
      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.headers['cache-control']).toBe('no-store');
      const foreign = await request(app)
        [method](ownerPath)
        .set('Cookie', cookie(userId));
      expect(foreign.status).toBe(404);
      expect(foreign.headers['cache-control']).toBe('no-store');
    },
  );

  it.each(['READY', 'SORTEADO', 'CANCELLED'] as const)(
    'closes every endpoint for %s groups',
    async (status) => {
      const token = await issueToken();
      group.status = status;
      const responses = await Promise.all([
        request(app).get(ownerPath).set('Cookie', cookie()),
        request(app).post(ownerPath).set('Cookie', cookie()),
        request(app).delete(ownerPath).set('Cookie', cookie()),
        request(app).get(publicPath(token)),
        request(app)
          .post(`${publicPath(token)}/join`)
          .set('Cookie', cookie(userId)),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(409);
        expect(response.body).toEqual({ error: 'INVITATION_CLOSED' });
        expect(response.headers['cache-control']).toBe('no-store');
      }
      expect(participants.size).toBe(0);
    },
  );

  it('rejects malformed group IDs, invalid tokens and nonempty management bodies', async () => {
    expect(
      (
        await request(app)
          .get('/groups/invalid/invitation')
          .set('Cookie', cookie())
      ).status,
    ).toBe(400);
    for (const token of ['invalid', 'a'.repeat(43)]) {
      const response = await request(app).get(publicPath(token));
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'INVITATION_NOT_FOUND' });
    }
    for (const method of ['post', 'delete'] as const) {
      expect(
        (
          await request(app)
            [method](ownerPath)
            .set('Cookie', cookie())
            .send({ email: 'x@example.com' })
        ).status,
      ).toBe(400);
    }
  });
});

describe('joining a group invitation', () => {
  it('requires confirmation and uses the authenticated account, protecting its identity at rest', async () => {
    const token = await issueToken();
    await request(app).get(publicPath(token));
    expect(participants.size).toBe(0);
    const response = await request(app)
      .post(`${publicPath(token)}/join`)
      .set('Cookie', cookie(userId))
      .send({});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      participation: { groupId, participantId: 'participant-0' },
    });
    expect(sendGroupJoinEmail).toHaveBeenCalledOnce();
    expect(sendGroupJoinEmail).toHaveBeenCalledWith({
      ownerEmail: 'owner@example.com',
      participantName: 'Convidado',
      groupId,
      groupName: 'Amigos',
    });
    const stored = participants.get('participant-0')!;
    expect(stored.userId).toBe(userId);
    expect(decryptData(stored.nameEncrypted)).toBe('Convidado');
    expect(decryptData(stored.emailEncrypted)).toBe('guest@example.com');
    expect(stored.emailLookupHash).toBe(
      createEmailLookupHash('guest@example.com'),
    );
    expect(JSON.stringify(stored)).not.toContain('guest@example.com');
    const listed = await request(app)
      .get('/groups')
      .set('Cookie', cookie(userId));
    expect(listed.status).toBe(200);
    expect(listed.body.groups).toEqual([
      expect.objectContaining({ id: groupId, roles: ['PARTICIPANT'] }),
    ]);
    expect(
      prismaMock.participant.findUnique.mock.invocationCallOrder[0],
    ).toBeGreaterThan(prismaMock.group.updateMany.mock.invocationCallOrder[1]);
  });

  it('is idempotent for an existing account participation', async () => {
    const token = await issueToken();
    const first = await joinGroupInvitation(token, userId);
    expect(await joinGroupInvitation(token, userId)).toEqual(first);
    expect(participants.size).toBe(1);
    expect(prismaMock.participant.create).toHaveBeenCalledOnce();
    expect(sendGroupJoinEmail).toHaveBeenCalledOnce();
  });

  it('keeps no-store on malformed JSON and oversized request bodies', async () => {
    const path = `${publicPath(await issueToken())}/join`;
    const malformed = await request(app)
      .post(path)
      .set('Cookie', cookie(userId))
      .set('Content-Type', 'application/json')
      .send('{');
    expect(malformed.status).toBe(400);
    expect(malformed.headers['cache-control']).toBe('no-store');
    const oversized = await request(app)
      .post(ownerPath)
      .set('Cookie', cookie())
      .send({ data: 'a'.repeat(101 * 1024) });
    expect(oversized.status).toBe(413);
    expect(oversized.headers['cache-control']).toBe('no-store');
  });

  it('links a manual participant without overwriting their name or other fields', async () => {
    const token = await issueToken();
    const existing = addParticipant('manual', 'guest@example.com');
    const snapshot = { ...existing };
    expect(await joinGroupInvitation(token, userId)).toEqual({
      groupId,
      participantId: existing.id,
    });
    expect(existing).toEqual({ ...snapshot, userId });
    expect(prismaMock.participant.create).not.toHaveBeenCalled();
    expect(prismaMock.participant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId } }),
    );
    expect(sendGroupJoinEmail).toHaveBeenCalledOnce();
  });

  it('allows the owner to join and retain both roles', async () => {
    await joinGroupInvitation(await issueToken(), ownerId);
    expect(sendGroupJoinEmail).not.toHaveBeenCalled();
    const listed = await request(app).get('/groups').set('Cookie', cookie());
    expect(listed.body.groups[0].roles).toEqual(['OWNER', 'PARTICIPANT']);
  });

  it('keeps a confirmed join when the email provider fails', async () => {
    const token = await issueToken();
    sendGroupJoinEmail.mockRejectedValueOnce(new Error('provider failed'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(joinGroupInvitation(token, userId)).resolves.toEqual({
        groupId, participantId: 'participant-0',
      });
      expect(errorLog).toHaveBeenCalledWith('group_join_email_failed', { groupId });
      expect(participants.size).toBe(1);
      await joinGroupInvitation(token, userId);
      expect(sendGroupJoinEmail).toHaveBeenCalledOnce();
    } finally {
      errorLog.mockRestore();
    }
  });

  it('rejects a participant linked to a different account without changing it', async () => {
    const token = await issueToken();
    addParticipant('claimed', 'guest@example.com', 'someone-else');
    const response = await request(app)
      .post(`${publicPath(token)}/join`)
      .set('Cookie', cookie(userId));
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'PARTICIPATION_ALREADY_CLAIMED' });
    expect(participants.get('claimed')?.userId).toBe('someone-else');
  });

  it('rejects absent sessions, deleted accounts, forged identity and untrusted origins', async () => {
    const path = `${publicPath(await issueToken())}/join`;
    expect((await request(app).post(path)).status).toBe(401);
    expect(
      (await request(app).post(path).set('Cookie', cookie('deleted'))).status,
    ).toBe(401);
    for (const body of [
      { userId: ownerId },
      { name: 'Fake', email: 'fake@example.com' },
      null,
      [],
    ]) {
      expect(
        (
          await request(app)
            .post(path)
            .set('Cookie', cookie(userId))
            .send(JSON.stringify(body))
            .set('Content-Type', 'application/json')
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await request(app)
          .post(path)
          .set('Cookie', cookie(userId))
          .set('Origin', 'https://evil.example')
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(ownerPath)
          .set('Cookie', cookie())
          .set('Origin', 'https://evil.example')
      ).status,
    ).toBe(403);
    expect(participants.size).toBe(0);
  });

  it('handles a concurrent unique constraint conflict as a business error', async () => {
    const token = await issueToken();
    prismaMock.participant.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6',
      }),
    );
    const response = await request(app)
      .post(`${publicPath(token)}/join`)
      .set('Cookie', cookie(userId));
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'PARTICIPATION_ALREADY_CLAIMED' });
  });

  it('enforces separate preview and join limits, including no-store on rejections', async () => {
    const path = publicPath(await issueToken());
    for (let i = 0; i < 60; i++)
      expect((await request(app).get(path)).status).toBe(200);
    const preview = await request(app).get(path);
    expect(preview.status).toBe(429);
    expect(preview.headers['cache-control']).toBe('no-store');
    for (let i = 0; i < 20; i++) {
      expect(
        (await request(app).post(`${path}/join`).set('Cookie', cookie(userId)))
          .status,
      ).toBe(200);
    }
    const join = await request(app)
      .post(`${path}/join`)
      .set('Cookie', cookie(userId));
    expect(join.status).toBe(429);
    expect(join.headers['cache-control']).toBe('no-store');
  });
});

describe('invitation transaction ordering and concurrency', () => {
  it('serializes simultaneous joins for the same account without duplicates', async () => {
    const token = await issueToken();
    const [first, second] = await Promise.all([
      joinGroupInvitation(token, userId),
      joinGroupInvitation(token, userId),
    ]);
    expect(first).toEqual(second);
    expect(participants.size).toBe(1);
  });

  it('serializes simultaneous claims of an existing manual participant', async () => {
    const token = await issueToken();
    addParticipant('manual', 'guest@example.com');
    const [first, second] = await Promise.all([
      joinGroupInvitation(token, userId),
      joinGroupInvitation(token, userId),
    ]);
    expect(first).toEqual({ groupId, participantId: 'manual' });
    expect(second).toEqual(first);
    expect(participants.size).toBe(1);
    expect(prismaMock.participant.updateMany).toHaveBeenCalledOnce();
  });

  it('preserves a committed participation when the invitation is revoked afterwards', async () => {
    const token = await issueToken();
    const joined = await joinGroupInvitation(token, userId);
    await deleteGroupInvitation(groupId, ownerId);
    expect(participants.get(joined.participantId)?.userId).toBe(userId);
    await expect(joinGroupInvitation(token, userId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it.each(['replace', 'delete'] as const)(
    'rechecks the token after waiting for a %s transaction',
    async (operation) => {
      const token = await issueToken();
      const entered = deferred();
      const finish = deferred();
      const defaultUpdate =
        prismaMock.group.updateMany.getMockImplementation()!;
      prismaMock.group.updateMany.mockImplementationOnce(async (args) => {
        entered.resolve();
        await finish.promise;
        return defaultUpdate(args);
      });
      const mutation =
        operation === 'replace'
          ? replaceGroupInvitation(groupId, ownerId)
          : deleteGroupInvitation(groupId, ownerId);
      await entered.promise;
      const readToken = deferred();
      const defaultFind =
        prismaMock.groupInvitation.findUnique.getMockImplementation()!;
      prismaMock.groupInvitation.findUnique.mockImplementationOnce(
        async (args) => {
          const found = await defaultFind(args);
          readToken.resolve();
          return found;
        },
      );
      const joining = joinGroupInvitation(token, userId);
      const rejected = expect(joining).rejects.toMatchObject({
        statusCode: 404,
      });
      await readToken.promise;
      finish.resolve();
      await mutation;
      await rejected;
      expect(participants.size).toBe(0);
    },
  );

  it('includes a joining participant when the join acquired the group lock first', async () => {
    const token = await issueToken();
    addParticipant('one', 'one@example.com');
    addParticipant('two', 'two@example.com');
    const entered = deferred();
    const finish = deferred();
    const create = prismaMock.participant.create.getMockImplementation()!;
    prismaMock.participant.create.mockImplementationOnce(async (args) => {
      entered.resolve();
      await finish.promise;
      return create(args);
    });
    const joining = joinGroupInvitation(token, userId);
    await entered.promise;
    const drawing = sortearGrupo(groupId, ownerId);
    finish.resolve();
    const participation = await joining;
    await drawing;
    expect(group.status).toBe('SORTEADO');
    expect(assignments.size).toBe(3);
    expect(assignments.has(participation.participantId)).toBe(true);
  });

  it('rejects a joining participant when the draw acquired the group lock first', async () => {
    const token = await issueToken();
    addParticipant('one', 'one@example.com');
    addParticipant('two', 'two@example.com');
    addParticipant('three', 'three@example.com');
    const entered = deferred();
    const finish = deferred();
    prismaMock.participant.findMany.mockImplementationOnce(async () => {
      entered.resolve();
      await finish.promise;
      return [...participants.values()];
    });
    const drawing = sortearGrupo(groupId, ownerId);
    await entered.promise;
    const joining = joinGroupInvitation(token, userId);
    const rejected = expect(joining).rejects.toMatchObject({
      statusCode: 409,
      code: 'INVITATION_CLOSED',
    });
    finish.resolve();
    await drawing;
    await rejected;
    expect(group.status).toBe('SORTEADO');
    expect(participants.size).toBe(3);
    expect(assignments.size).toBe(3);
  });

  it('rolls back a failed draw so registration remains available', async () => {
    const token = await issueToken();
    await expect(sortearGrupo(groupId, ownerId)).rejects.toMatchObject({
      code: 'SORTEIO_NOT_VIABLE',
    });
    expect(group.status).toBe('DRAFT');
    expect(group.sorteadoAt).toBeNull();
    expect(assignments.size).toBe(0);
    await expect(joinGroupInvitation(token, userId)).resolves.toMatchObject({
      groupId,
    });
  });
});
