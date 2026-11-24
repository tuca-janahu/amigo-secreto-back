import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { encryptData } from '../src/lib/data-protection.js';
import {
  generateGroupInvitationToken,
  hashGroupInvitationToken,
} from '../src/modules/group-invitations/group-invitations.tokens.js';

let database: PGlite;
const directory = new URL('../prisma/migrations/', import.meta.url);

beforeAll(async () => {
  database = new PGlite();
  const migrations = (await readdir(directory))
    .filter((name) => /^\d/.test(name))
    .sort();
  const invitationIndex = migrations.indexOf(
    '20261123000000_add_group_invitations',
  );
  if (invitationIndex === -1)
    throw new Error('Invitation migration not found.');
  for (const migration of migrations.slice(0, invitationIndex)) {
    await database.exec(
      await readFile(new URL(`${migration}/migration.sql`, directory), 'utf8'),
    );
  }
  await database.exec(`
    INSERT INTO "User" (id, name, email, "passwordHash", "updatedAt") VALUES
      ('owner', 'Organizador', 'owner@example.com', 'test-hash', now());
    INSERT INTO "Group" (id, "ownerId", name, "updatedAt") VALUES
      ('existing', 'owner', 'Grupo existente', now()),
      ('other', 'owner', 'Outro grupo', now());
    INSERT INTO "Participant" (id, "groupId", "nameEncrypted", "emailEncrypted", "emailLookupHash", "updatedAt")
      VALUES ('manual', 'existing', 'encrypted-name', 'encrypted-email', 'lookup', now());
  `);
  for (const migration of migrations.slice(invitationIndex)) {
    await database.exec(
      await readFile(new URL(`${migration}/migration.sql`, directory), 'utf8'),
    );
  }
}, 30_000);

afterAll(async () => {
  await database?.close();
});

const insertInvitation = async (id: string, groupId: string, token: string) => {
  await database.query(
    `
    INSERT INTO "GroupInvitation" (id, "groupId", "tokenHash", "tokenEncrypted", "updatedAt")
      VALUES ($1, $2, $3, $4, now())
  `,
    [id, groupId, hashGroupInvitationToken(token), encryptData(token)],
  );
};

describe('group invitation PostgreSQL migration and integrity', () => {
  it('preserves existing groups and participants and starts without invitations', async () => {
    expect((await database.query('SELECT id FROM "Group"')).rows).toHaveLength(
      2,
    );
    expect((await database.query('SELECT id FROM "Participant"')).rows).toEqual(
      [{ id: 'manual' }],
    );
    expect(
      (await database.query('SELECT id FROM "GroupInvitation"')).rows,
    ).toEqual([]);
  });

  it('stores protected tokens and enforces a single invitation per group and unique hashes', async () => {
    const token = generateGroupInvitationToken();
    await insertInvitation('active', 'existing', token);
    const { rows } = await database.query(
      'SELECT * FROM "GroupInvitation" WHERE id = $1',
      ['active'],
    );
    expect(rows[0]).toMatchObject({
      tokenHash: hashGroupInvitationToken(token),
    });
    expect(JSON.stringify(rows)).not.toContain(token);
    await expect(
      insertInvitation(
        'duplicate-group',
        'existing',
        generateGroupInvitationToken(),
      ),
    ).rejects.toThrow();
    await expect(
      insertInvitation('duplicate-hash', 'other', token),
    ).rejects.toThrow();
    await expect(
      insertInvitation(
        'missing-group',
        'absent',
        generateGroupInvitationToken(),
      ),
    ).rejects.toThrow();
    expect(
      (await database.query('SELECT id FROM "GroupInvitation"')).rows,
    ).toEqual([{ id: 'active' }]);
  });

  it('rolls back an early draw status change when the transaction fails', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.query(
          `UPDATE "Group" SET status = 'SORTEADO', "sorteadoAt" = now() WHERE id = 'existing' AND status = 'DRAFT'`,
        );
        throw new Error('Draw is not viable');
      }),
    ).rejects.toThrow('Draw is not viable');
    expect(
      (
        await database.query(
          'SELECT status, "sorteadoAt" FROM "Group" WHERE id = $1',
          ['existing'],
        )
      ).rows,
    ).toEqual([{ status: 'DRAFT', sorteadoAt: null }]);
  });

  it('deletes invitations in cascade with their group', async () => {
    await database.query('DELETE FROM "Group" WHERE id = $1', ['existing']);
    expect(
      (await database.query('SELECT id FROM "GroupInvitation"')).rows,
    ).toEqual([]);
    expect((await database.query('SELECT id FROM "Participant"')).rows).toEqual(
      [],
    );
  });
});
