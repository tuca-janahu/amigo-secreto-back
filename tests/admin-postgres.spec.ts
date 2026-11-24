import { readFile, readdir } from 'node:fs/promises';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));

import { getTimeseries } from '../src/modules/admin/admin.service.js';
import { dashboardQuerySchema } from '../src/modules/admin/admin.schemas.js';
import { recordAuditEvent } from '../src/modules/audit/audit.service.js';

let database: PGlite;
const migrationsDirectory = new URL('../prisma/migrations/', import.meta.url);

beforeAll(async () => {
  database = new PGlite();
  const migrations = (await readdir(migrationsDirectory))
    .filter((name) => /^\d/.test(name))
    .sort();
  // Seed before the audit migration, even when later migrations are added.
  const auditMigrationIndex = migrations.indexOf(
    '20261120000000_add_admin_audit',
  );
  if (auditMigrationIndex === -1) throw new Error('Audit migration not found.');
  for (const migration of migrations.slice(0, auditMigrationIndex)) {
    await database.exec(
      await readFile(
        new URL(`${migration}/migration.sql`, migrationsDirectory),
        'utf8',
      ),
    );
  }
  await database.exec(`
    INSERT INTO "User" (id, name, email, "passwordHash", "createdAt", "updatedAt") VALUES
      ('owner', 'Organizador', 'owner@example.com', 'fake-test-hash', '2026-11-01 02:59:59.999', now()),
      ('new-user', 'Conta nova', 'new@example.com', 'fake-test-hash', '2026-11-01 03:00:00', now()),
      ('last-user', 'Última conta', 'last@example.com', 'fake-test-hash', '2026-11-04 02:59:59.999', now()),
      ('excluded-user', 'Fora do período', 'excluded@example.com', 'fake-test-hash', '2026-11-04 03:00:00', now());
    INSERT INTO "Group" (id, "ownerId", name, status, "createdAt", "sorteadoAt", "updatedAt") VALUES
      ('before', 'owner', 'Criado antes', 'SORTEADO', '2026-11-01 02:59:59.999', '2026-11-01 03:00:00', now()),
      ('first', 'owner', 'Primeiro', 'DRAFT', '2026-11-01 03:00:00', null, now()),
      ('second', 'owner', 'Segundo', 'SORTEADO', '2026-11-02 02:59:59.999', '2026-11-02 03:00:00', now()),
      ('excluded', 'owner', 'Fora do período', 'DRAFT', '2026-11-04 03:00:00', null, now());
  `);
  for (const migration of migrations.slice(auditMigrationIndex)) {
    await database.exec(
      await readFile(
        new URL(`${migration}/migration.sql`, migrationsDirectory),
        'utf8',
      ),
    );
  }
  prismaMock.$queryRaw.mockImplementation(
    async (sql: Prisma.Sql) =>
      (await database.query(sql.text, sql.values)).rows,
  );
}, 30_000);

afterAll(async () => {
  await database?.close();
});

// Only the two persistence operations used by the audit writer need an adapter.
const auditTransaction = (transaction: Transaction): Prisma.TransactionClient =>
  ({
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        (
          await transaction.query('SELECT name FROM "User" WHERE id = $1', [
            where.id,
          ])
        ).rows[0] ?? null,
    },
    auditEvent: {
      create: async ({
        data,
      }: {
        data: Prisma.AuditEventUncheckedCreateInput;
      }) => {
        await transaction.query(
          `
        INSERT INTO "AuditEvent" (id, type, "actorUserId", "actorName", "groupId", "groupName")
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
          [
            data.id ?? `event-${data.groupId}`,
            data.type,
            data.actorUserId,
            data.actorName,
            data.groupId ?? null,
            data.groupName ?? null,
          ],
        );
        return { id: data.id };
      },
    },
  }) as unknown as Prisma.TransactionClient;

describe('admin PostgreSQL migration and queries', () => {
  it('preserves existing data and starts with no reconstructed events', async () => {
    expect(
      (await database.query('SELECT id FROM "User" ORDER BY id')).rows,
    ).toHaveLength(4);
    expect((await database.query('SELECT id FROM "AuditEvent"')).rows).toEqual(
      [],
    );
    const indexes = await database.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename IN ('AuditEvent', 'User', 'Group', 'Notification')`,
    );
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        'AuditEvent_occurredAt_id_idx',
        'AuditEvent_actorUserId_occurredAt_id_idx',
        'AuditEvent_groupId_occurredAt_id_idx',
        'AuditEvent_type_occurredAt_id_idx',
        'User_createdAt_idx',
        'Group_createdAt_idx',
        'Group_sorteadoAt_idx',
        'Notification_createdAt_idx',
      ]),
    );
  });

  it('executes production SQL with local dates, inclusive dates, exclusive instants, and empty days', async () => {
    const result = await getTimeseries(
      dashboardQuerySchema.parse({ from: '2026-11-01', to: '2026-11-03' }),
    );
    expect(result.items).toEqual([
      { date: '2026-11-01', users: 1, groups: 2, sorteios: 1 },
      { date: '2026-11-02', users: 0, groups: 0, sorteios: 1 },
      { date: '2026-11-03', users: 1, groups: 0, sorteios: 0 },
    ]);
    expect(result.period).toEqual({
      from: '2026-11-01',
      to: '2026-11-03',
      timeZone: 'America/Sao_Paulo',
    });
  });

  it('does not depend on the database connection timezone', async () => {
    await database.exec("SET TIME ZONE 'Pacific/Honolulu'");
    try {
      const result = await getTimeseries(
        dashboardQuerySchema.parse({ from: '2026-11-01', to: '2026-11-01' }),
      );
      expect(result.items).toEqual([
        { date: '2026-11-01', users: 1, groups: 2, sorteios: 1 },
      ]);
    } finally {
      await database.exec("SET TIME ZONE 'UTC'");
    }
  });

  it('returns zero-filled series when there is no activity', async () => {
    const result = await getTimeseries(
      dashboardQuerySchema.parse({ from: '2026-11-10', to: '2026-11-11' }),
    );
    expect(result.items).toEqual([
      { date: '2026-11-10', users: 0, groups: 0, sorteios: 0 },
      { date: '2026-11-11', users: 0, groups: 0, sorteios: 0 },
    ]);
  });

  it('retains actor and group snapshots after rename and physical group deletion', async () => {
    await database.transaction(async (transaction) => {
      await recordAuditEvent(auditTransaction(transaction), {
        type: 'GROUP_DELETED',
        actorUserId: 'owner',
        groupId: 'first',
        groupName: 'Primeiro',
      });
      await transaction.query('DELETE FROM "Group" WHERE id = $1', ['first']);
      await transaction.query('UPDATE "User" SET name = $1 WHERE id = $2', [
        'Nome atualizado',
        'owner',
      ]);
    });
    const { rows } = await database.query(
      'SELECT "actorName", "groupName" FROM "AuditEvent" WHERE "groupId" = $1',
      ['first'],
    );
    expect(rows).toEqual([{ actorName: 'Organizador', groupName: 'Primeiro' }]);
  });

  it('rolls back business writes when the audit insert fails', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.query(`
        INSERT INTO "Group" (id, "ownerId", name, "updatedAt") VALUES ('rollback-group', 'owner', 'Rollback', now())
      `);
        const client = auditTransaction(transaction);
        await recordAuditEvent(client, {
          type: 'GROUP_CREATED',
          actorUserId: 'owner',
          groupId: 'rollback-group',
          groupName: 'Rollback',
        });
        // Duplicate ID forces a real PostgreSQL constraint error inside the transaction.
        await recordAuditEvent(client, {
          type: 'GROUP_CREATED',
          actorUserId: 'owner',
          groupId: 'rollback-group',
          groupName: 'Rollback',
        });
      }),
    ).rejects.toThrow();
    expect(
      (
        await database.query('SELECT id FROM "Group" WHERE id = $1', [
          'rollback-group',
        ])
      ).rows,
    ).toEqual([]);
    expect(
      (
        await database.query(
          'SELECT id FROM "AuditEvent" WHERE "groupId" = $1',
          ['rollback-group'],
        )
      ).rows,
    ).toEqual([]);
  });
});
