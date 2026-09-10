import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  group: {
    findFirst: vi.fn(),
  },
  participant: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));

import { createAuthToken } from '../src/lib/auth-token.js';
import { parseParticipantImport } from '../src/modules/participants/participants.import.js';
import { app } from '../src/app.js';

type StoredGroup = {
  id: string;
  ownerId: string;
  status: 'DRAFT' | 'READY' | 'SORTEADO' | 'CANCELLED';
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

beforeEach(() => {
  vi.clearAllMocks();
  groups.clear();
  participants.clear();

  prismaMock.group.findFirst.mockImplementation(async ({ where }) => {
    const group = groups.get(where.id);
    return group?.ownerId === where.ownerId ? group : null;
  });
  prismaMock.participant.findFirst.mockImplementation(async ({ where }) => {
    const participant = [...participants.values()].find(
      (storedParticipant) =>
        storedParticipant.groupId === where.groupId &&
        storedParticipant.emailLookupHash === where.emailLookupHash,
    );

    return participant ?? null;
  });
  prismaMock.participant.findMany.mockImplementation(async ({ where }) =>
    [...participants.values()].filter(
      (participant) =>
        participant.groupId === where.groupId &&
        (!where.emailLookupHash?.in ||
          where.emailLookupHash.in.includes(participant.emailLookupHash)),
    ),
  );
  prismaMock.participant.create.mockImplementation(async ({ data }) => {
    const now = new Date();
    const participant = {
      id: cuid(participants.size + 100),
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    participants.set(participant.id, participant);
    return participant;
  });
  prismaMock.$transaction.mockImplementation(async (callback) =>
    callback({ participant: { create: prismaMock.participant.create } }),
  );
});

describe('participant import parser', () => {
  it('parses TAB and semicolon data, ignoring empty lines and a simple header', () => {
    const tabResult = parseParticipantImport(
      '\nNome\tEmail\nLucas\tlucas@email.com\n\nMaria\tmaria@email.com\n',
    );
    const semicolonResult = parseParticipantImport('Lucas; LUCAS@email.com');

    expect(tabResult.issues).toEqual([]);
    expect(tabResult.participants).toEqual([
      { line: 3, name: 'Lucas', email: 'lucas@email.com' },
      { line: 5, name: 'Maria', email: 'maria@email.com' },
    ]);
    expect(semicolonResult.issues).toEqual([]);
    expect(semicolonResult.participants).toEqual([
      { line: 1, name: 'Lucas', email: 'lucas@email.com' },
    ]);
  });

  it('reports invalid column counts, email addresses, and names', () => {
    const invalidColumns = parseParticipantImport('Lucas\tlucas@email.com\textra');
    const invalidEmail = parseParticipantImport('Lucas\tinvalid-email');
    const invalidName = parseParticipantImport('\tlucas@email.com');

    expect(invalidColumns.issues[0]).toMatchObject({ line: 1 });
    expect(invalidEmail.issues[0]).toEqual({ line: 1, reason: 'E-mail inválido.' });
    expect(invalidName.issues[0]).toEqual({ line: 1, reason: 'Nome inválido.' });
  });
});

describe('POST /groups/:groupId/participants/import', () => {
  it('imports multiple protected participants in one transaction', async () => {
    const groupId = cuid(1);
    addGroup(groupId, 'owner-1');

    const response = await request(app)
      .post(`/groups/${groupId}/participants/import`)
      .set('Cookie', authCookie('owner-1'))
      .send({
        data: 'Lucas\tlucas@email.com\nMaria\tmaria@email.com',
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ imported: 2 });
    expect(response.body.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Lucas', email: 'lucas@email.com' }),
        expect.objectContaining({ name: 'Maria', email: 'maria@email.com' }),
      ]),
    );
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
    expect(participants.size).toBe(2);

    for (const participant of participants.values()) {
      expect(participant.nameEncrypted).not.toContain('Lucas');
      expect(participant.nameEncrypted).not.toContain('Maria');
      expect(participant.emailEncrypted).not.toContain('lucas@email.com');
      expect(participant.emailEncrypted).not.toContain('maria@email.com');
      expect(participant.emailEncrypted).not.toContain('@email.com');
      expect(participant.emailLookupHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('does not persist any participant when any line is invalid', async () => {
    const groupId = cuid(1);
    addGroup(groupId, 'owner-1');

    const response = await request(app)
      .post(`/groups/${groupId}/participants/import`)
      .set('Cookie', authCookie('owner-1'))
      .send({ data: 'Lucas\tlucas@email.com\nMaria\tinvalid-email' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('linha 2');
    expect(participants.size).toBe(0);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects duplicate emails in the same paste without persisting', async () => {
    const groupId = cuid(1);
    addGroup(groupId, 'owner-1');

    const response = await request(app)
      .post(`/groups/${groupId}/participants/import`)
      .set('Cookie', authCookie('owner-1'))
      .send({ data: 'Lucas\tTESTE@email.com\nMaria\tteste@email.com' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('linha 2');
    expect(response.body.message).toContain('linha 1');
    expect(participants.size).toBe(0);
  });

  it('rejects an email already in the group but allows it in another group', async () => {
    const firstGroupId = cuid(1);
    const secondGroupId = cuid(2);
    addGroup(firstGroupId, 'owner-1');
    addGroup(secondGroupId, 'owner-1');

    await request(app)
      .post(`/groups/${firstGroupId}/participants/import`)
      .set('Cookie', authCookie('owner-1'))
      .send({ data: 'Lucas\tlucas@email.com' });

    const duplicateResponse = await request(app)
      .post(`/groups/${firstGroupId}/participants/import`)
      .set('Cookie', authCookie('owner-1'))
      .send({ data: 'Maria\tLUCAS@email.com' });
    const otherGroupResponse = await request(app)
      .post(`/groups/${secondGroupId}/participants/import`)
      .set('Cookie', authCookie('owner-1'))
      .send({ data: 'Lucas\tlucas@email.com' });

    expect(duplicateResponse.status).toBe(409);
    expect(otherGroupResponse.status).toBe(201);
    expect(participants.size).toBe(2);
  });

  it('rejects more than 100 participants before persisting', async () => {
    const groupId = cuid(1);
    addGroup(groupId, 'owner-1');
    const data = Array.from(
      { length: 101 },
      (_, index) => `Person ${index}\tperson${index}@email.com`,
    ).join('\n');

    const response = await request(app)
      .post(`/groups/${groupId}/participants/import`)
      .set('Cookie', authCookie('owner-1'))
      .send({ data });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('limite de 100');
    expect(participants.size).toBe(0);
  });

  it('returns 404 to another user and 409 outside DRAFT', async () => {
    const privateGroupId = cuid(1);
    const readyGroupId = cuid(2);
    addGroup(privateGroupId, 'owner-2');
    addGroup(readyGroupId, 'owner-1', 'READY');

    const otherUserResponse = await request(app)
      .post(`/groups/${privateGroupId}/participants/import`)
      .set('Cookie', authCookie('owner-1'))
      .send({ data: 'Lucas\tlucas@email.com' });
    const statusResponse = await request(app)
      .post(`/groups/${readyGroupId}/participants/import`)
      .set('Cookie', authCookie('owner-1'))
      .send({ data: 'Lucas\tlucas@email.com' });

    expect(otherUserResponse.status).toBe(404);
    expect(statusResponse.status).toBe(409);
  });
});
