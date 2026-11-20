import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const access = vi.hoisted(() => ({ ids: ['admin-1'] }));
const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  user: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  group: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  participant: { count: vi.fn(), groupBy: vi.fn() },
  notification: { groupBy: vi.fn() },
  auditEvent: { findMany: vi.fn(), count: vi.fn() },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/env.js')>();
  return {
    config: {
      ...actual.config,
      get adminUserIds() {
        return access.ids;
      },
    },
  };
});

import { app } from '../src/app.js';
import { createAuthToken } from '../src/lib/auth-token.js';
import { dashboardQuerySchema } from '../src/modules/admin/admin.schemas.js';

const period = { from: '2026-11-01', to: '2026-11-20' };
const range = {
  gte: new Date('2026-11-01T03:00:00Z'),
  lt: new Date('2026-11-21T03:00:00Z'),
};
const cookie = (id = 'admin-1') => `auth_token=${createAuthToken(id)}`;
const adminGet = (path: string) =>
  request(app).get(path).set('Cookie', cookie());

beforeEach(() => {
  vi.resetAllMocks();
  access.ids = ['admin-1'];
  prismaMock.$transaction.mockImplementation(async (callback) =>
    callback(prismaMock),
  );
  prismaMock.user.findUnique.mockImplementation(async ({ where }) =>
    where.id === 'missing'
      ? null
      : { id: where.id, name: 'Organizador', email: 'owner@example.com' },
  );
  prismaMock.user.count.mockResolvedValue(0);
  prismaMock.group.count.mockResolvedValue(0);
  prismaMock.participant.count.mockResolvedValue(0);
  prismaMock.group.groupBy.mockResolvedValue([]);
  prismaMock.notification.groupBy.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.group.findMany.mockResolvedValue([]);
  prismaMock.auditEvent.findMany.mockResolvedValue([]);
  prismaMock.auditEvent.count.mockResolvedValue(0);
  prismaMock.$queryRaw.mockResolvedValue([]);
});

describe('admin authorization', () => {
  const paths = ['overview', 'timeseries', 'users', 'groups', 'audit-events'];

  it.each(paths)(
    'protects /admin/%s and prevents caching even on errors',
    async (path) => {
      const anonymous = await request(app).get(`/admin/${path}`);
      const regular = await request(app)
        .get(`/admin/${path}`)
        .set('Cookie', cookie('user-1'));
      expect(anonymous.status).toBe(401);
      expect(regular.status).toBe(403);
      expect(anonymous.headers['cache-control']).toBe('no-store');
      expect(regular.headers['cache-control']).toBe('no-store');
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    },
  );

  it('rejects a deleted account even if its id is configured and token is valid', async () => {
    access.ids = ['missing'];
    expect(
      (await request(app).get('/admin/users').set('Cookie', cookie('missing')))
        .status,
    ).toBe(401);
  });

  it('denies access after permission removal, without issuing a new token', async () => {
    const session = cookie();
    expect(
      (await request(app).get('/admin/users').set('Cookie', session)).status,
    ).toBe(200);
    access.ids = [];
    expect(
      (await request(app).get('/admin/users').set('Cookie', session)).status,
    ).toBe(403);
  });

  it('rejects tampered sessions', async () => {
    expect(
      (
        await request(app)
          .get('/admin/users')
          .set('Cookie', 'auth_token=invalid')
      ).status,
    ).toBe(401);
  });

  it('exposes the administrative capability through /auth/me', async () => {
    expect((await adminGet('/auth/me')).body.user.isAdmin).toBe(true);
    access.ids = [];
    expect((await adminGet('/auth/me')).body.user.isAdmin).toBe(false);
  });

  it('provides no administrative mutations', async () => {
    expect(
      (
        await request(app)
          .delete('/admin/groups/group-1')
          .set('Cookie', cookie())
      ).status,
    ).toBe(404);
  });
});

describe('admin queries', () => {
  it('returns zero counts and a zero reveal percentage for an empty platform', async () => {
    const response = await adminGet('/admin/overview').query(period);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      totals: {
        users: 0,
        groups: 0,
        sorteios: 0,
        participations: 0,
        groupsByStatus: { DRAFT: 0, READY: 0, SORTEADO: 0, CANCELLED: 0 },
      },
      engagement: { participations: 0, revealed: 0, revealRate: 0 },
      invitations: {
        attempts: 0,
        attemptsByStatus: { PENDING: 0, SENT: 0, DELIVERED: 0, FAILED: 0 },
      },
    });
  });

  it('separates lifetime totals, period activity, the draw cohort, and invitation attempts', async () => {
    prismaMock.user.count.mockResolvedValueOnce(10).mockResolvedValueOnce(2);
    prismaMock.group.count
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);
    prismaMock.participant.count
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2);
    prismaMock.group.groupBy.mockResolvedValue([
      { status: 'SORTEADO', _count: { _all: 4 } },
    ]);
    prismaMock.notification.groupBy.mockResolvedValue([
      { status: 'SENT', _count: { _all: 6 } },
      { status: 'FAILED', _count: { _all: 2 } },
    ]);
    const response = await adminGet('/admin/overview').query(period);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      totals: { users: 10, groups: 8, sorteios: 4, participations: 20 },
      activity: { newUsers: 2, newGroups: 3, completedSorteios: 1 },
      engagement: { participations: 5, revealed: 2, revealRate: 40 },
      invitations: { attempts: 8, attemptsByStatus: { SENT: 6, FAILED: 2 } },
    });
    expect(prismaMock.participant.count).toHaveBeenCalledWith({
      where: {
        group: { sorteadoAt: range },
        accesses: { some: { revealedAt: { not: null } } },
      },
    });
    expect(prismaMock.notification.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          type: 'SORTEIO_INVITATION',
          channel: 'EMAIL',
          createdAt: range,
        },
      }),
    );
  });

  it.each([
    ['/admin/overview', { from: '2026-11-20', to: '2026-11-01' }],
    ['/admin/timeseries', { from: '2026-01-01', to: '2026-04-01' }],
    ['/admin/overview', { from: '2026-02-30' }],
    ['/admin/overview', { from: '0000-01-01', to: '0000-01-01' }],
    ['/admin/overview', { from: '9999-12-31', to: '9999-12-31' }],
    ['/admin/users', { page: '0' }],
    ['/admin/users', { pageSize: '101' }],
    ['/admin/groups', { status: 'INVALID' }],
    ['/admin/audit-events', { type: 'LOGIN' }],
    ['/admin/audit-events', { from: 'invalid' }],
    ['/admin/users', { q: ['one', 'two'] }],
    ['/admin/overview', { userId: 'unexpected' }],
  ])('rejects invalid filters for %s: %j', async (path, query) => {
    expect((await adminGet(path).query(query)).status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it('paginates users with case-insensitive search and counts draws only for this page', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: 'owner-1',
        name: 'Ana',
        email: 'ana@example.com',
        createdAt: new Date(),
        _count: { groups: 3 },
      },
    ]);
    prismaMock.user.count.mockResolvedValue(42);
    prismaMock.group.groupBy.mockResolvedValue([
      { ownerId: 'owner-1', _count: { _all: 2 } },
    ]);
    const response = await adminGet('/admin/users').query({
      q: ' ANA ',
      page: 2,
      pageSize: 10,
    });
    expect(response.body).toMatchObject({
      page: 2,
      pageSize: 10,
      total: 42,
      items: [{ id: 'owner-1', groupsCount: 3, sorteiosCount: 2 }],
    });
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        where: {
          OR: [
            { name: { contains: 'ANA', mode: 'insensitive' } },
            { email: { contains: 'ANA', mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          _count: { select: { groups: true } },
        },
      }),
    );
  });

  it('lists groups with creator and counts without selecting participant data or assignments', async () => {
    prismaMock.group.findMany.mockResolvedValue([
      {
        id: 'group-1',
        name: 'Família',
        status: 'SORTEADO',
        owner: { id: 'owner-1', name: 'Ana', email: 'ana@example.com' },
        createdAt: new Date(),
        sorteadoAt: new Date(),
        _count: { participants: 3 },
      },
    ]);
    prismaMock.group.count.mockResolvedValue(1);
    prismaMock.participant.groupBy.mockResolvedValue([
      { groupId: 'group-1', _count: { _all: 2 } },
    ]);
    const response = await adminGet('/admin/groups').query({
      q: 'Família',
      ownerId: 'owner-1',
      status: 'SORTEADO',
    });
    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({
      participantsCount: 3,
      revealedCount: 2,
      owner: { id: 'owner-1' },
    });
    const query = prismaMock.group.findMany.mock.calls[0][0];
    expect(query.where).toEqual({
      name: { contains: 'Família', mode: 'insensitive' },
      ownerId: 'owner-1',
      status: 'SORTEADO',
    });
    expect(query.select).toEqual({
      id: true,
      name: true,
      status: true,
      createdAt: true,
      sorteadoAt: true,
      owner: { select: { id: true, name: true, email: true } },
      _count: { select: { participants: true } },
    });
    expect(prismaMock.participant.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['groupId'],
        where: {
          groupId: { in: ['group-1'] },
          accesses: { some: { revealedAt: { not: null } } },
        },
      }),
    );
  });

  it('filters retained audit snapshots without joining a possibly deleted group', async () => {
    const event = {
      id: 'event-1',
      type: 'GROUP_DELETED',
      actorUserId: 'owner-1',
      actorName: 'Ana',
      groupId: 'deleted-group',
      groupName: 'Rascunho',
      occurredAt: new Date('2026-11-15T12:00:00Z'),
    };
    prismaMock.auditEvent.findMany.mockResolvedValue([event]);
    prismaMock.auditEvent.count.mockResolvedValue(1);
    const response = await adminGet('/admin/audit-events').query({
      ...period,
      type: event.type,
      actorUserId: event.actorUserId,
      groupId: event.groupId,
    });
    expect(response.body.items[0]).toEqual({
      ...event,
      occurredAt: event.occurredAt.toISOString(),
    });
    expect(prismaMock.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          occurredAt: range,
          type: event.type,
          actorUserId: event.actorUserId,
          groupId: event.groupId,
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('returns a generic server error when database access fails', async () => {
    prismaMock.user.findMany.mockRejectedValue(
      new Error('private database information'),
    );
    const response = await adminGet('/admin/users');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Erro interno do servidor.' });
  });
});

describe('admin date ranges', () => {
  it('defaults to 30 local dates even near the UTC day boundary', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-21T01:00:00Z'));
      expect(dashboardQuerySchema.parse({})).toMatchObject({
        from: '2026-10-22',
        to: '2026-11-20',
        start: new Date('2026-10-22T03:00:00Z'),
        end: range.lt,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts exactly 90 dates and uses exclusive next-day midnight', () => {
    expect(
      dashboardQuerySchema.parse({ from: '2026-01-01', to: '2026-03-31' }),
    ).toMatchObject({
      start: new Date('2026-01-01T03:00:00Z'),
      end: new Date('2026-04-01T03:00:00Z'),
    });
  });

  it('handles a historical local date with no midnight due to daylight saving', () => {
    expect(
      dashboardQuerySchema.parse({ from: '2018-11-04', to: '2018-11-04' }),
    ).toMatchObject({
      start: new Date('2018-11-04T03:00:00Z'),
      end: new Date('2018-11-05T02:00:00Z'),
    });
  });
});
