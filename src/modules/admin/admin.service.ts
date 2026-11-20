import { GroupStatus, NotificationStatus, Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import {
  publicPeriod,
  type AdminPeriod,
  type AuditQuery,
  type GroupsQuery,
  type UsersQuery,
} from './admin.schemas.js';

const dateFilter = (period: AdminPeriod) => ({
  gte: period.start,
  lt: period.end,
});
const snapshotOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
};

export const getOverview = (period: AdminPeriod) =>
  prisma.$transaction(async (transaction) => {
    const range = dateFilter(period);
    const cohort: Prisma.ParticipantWhereInput = {
      group: { sorteadoAt: range },
    };
    const [
      users,
      groups,
      sorteios,
      participations,
      statuses,
      newUsers,
      newGroups,
      completedSorteios,
      cohortParticipations,
      revealedParticipations,
      notifications,
    ] = await Promise.all([
      transaction.user.count(),
      transaction.group.count(),
      transaction.group.count({ where: { sorteadoAt: { not: null } } }),
      transaction.participant.count(),
      transaction.group.groupBy({ by: ['status'], _count: { _all: true } }),
      transaction.user.count({ where: { createdAt: range } }),
      transaction.group.count({ where: { createdAt: range } }),
      transaction.group.count({ where: { sorteadoAt: range } }),
      transaction.participant.count({ where: cohort }),
      transaction.participant.count({
        where: { ...cohort, accesses: { some: { revealedAt: { not: null } } } },
      }),
      transaction.notification.groupBy({
        by: ['status'],
        where: {
          type: 'SORTEIO_INVITATION',
          channel: 'EMAIL',
          createdAt: range,
        },
        _count: { _all: true },
      }),
    ]);
    const groupsByStatus = Object.fromEntries(
      Object.values(GroupStatus).map((status) => [
        status,
        statuses.find((row) => row.status === status)?._count._all ?? 0,
      ]),
    );
    const attemptsByStatus = Object.fromEntries(
      Object.values(NotificationStatus).map((status) => [
        status,
        notifications.find((row) => row.status === status)?._count._all ?? 0,
      ]),
    );
    return {
      period: publicPeriod(period),
      totals: { users, groups, sorteios, participations, groupsByStatus },
      activity: { newUsers, newGroups, completedSorteios },
      engagement: {
        participations: cohortParticipations,
        revealed: revealedParticipations,
        revealRate:
          cohortParticipations === 0
            ? 0
            : Math.round(
                (revealedParticipations / cohortParticipations) * 10_000,
              ) / 100,
      },
      invitations: {
        attempts: notifications.reduce((sum, row) => sum + row._count._all, 0),
        attemptsByStatus,
      },
    };
  }, snapshotOptions);

type DailyCounts = {
  date: string;
  users: number;
  groups: number;
  sorteios: number;
};

export const getTimeseries = async (period: AdminPeriod) => {
  const start = period.start.toISOString();
  const end = period.end.toISOString();
  // PostgreSQL performs daily timezone aggregation and returns at most 90 rows.
  // Prisma groupBy cannot truncate dates; fetching all timestamps would scale with platform usage.
  // Prisma DateTime columns store UTC as timestamp WITHOUT time zone.
  const items = await prisma.$queryRaw<DailyCounts[]>(Prisma.sql`
    WITH activity AS (
      SELECT ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date AS day,
             'users' AS metric FROM "User"
      WHERE "createdAt" >= ${start}::timestamp AND "createdAt" < ${end}::timestamp
      UNION ALL
      SELECT ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date,
             'groups' FROM "Group"
      WHERE "createdAt" >= ${start}::timestamp AND "createdAt" < ${end}::timestamp
      UNION ALL
      SELECT ("sorteadoAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date,
             'sorteios' FROM "Group"
      WHERE "sorteadoAt" >= ${start}::timestamp AND "sorteadoAt" < ${end}::timestamp
    )
    SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
           (count(*) FILTER (WHERE activity.metric = 'users'))::int AS users,
           (count(*) FILTER (WHERE activity.metric = 'groups'))::int AS groups,
           (count(*) FILTER (WHERE activity.metric = 'sorteios'))::int AS sorteios
    FROM generate_series(${period.from}::timestamp, ${period.to}::timestamp, interval '1 day') AS days(day)
    LEFT JOIN activity ON activity.day = days.day::date
    GROUP BY days.day ORDER BY days.day
  `);
  return { period: publicPeriod(period), items };
};

const pagination = ({
  page,
  pageSize,
}: {
  page: number;
  pageSize: number;
}) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
});
const pageResult = <T>(
  items: T[],
  total: number,
  query: { page: number; pageSize: number },
) => ({
  items,
  page: query.page,
  pageSize: query.pageSize,
  total,
});

export const listAdminUsers = (query: UsersQuery) =>
  prisma.$transaction(async (transaction) => {
    const where: Prisma.UserWhereInput = query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' } },
            { email: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {};
    const [users, total] = await Promise.all([
      transaction.user.findMany({
        where,
        ...pagination(query),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          _count: { select: { groups: true } },
        },
      }),
      transaction.user.count({ where }),
    ]);
    // Count completed groups for this page only, without fetching their contents.
    const sorteios =
      users.length === 0
        ? []
        : await transaction.group.groupBy({
            by: ['ownerId'],
            where: {
              ownerId: { in: users.map((user) => user.id) },
              sorteadoAt: { not: null },
            },
            _count: { _all: true },
          });
    return pageResult(
      users.map(({ _count, ...user }) => ({
        ...user,
        groupsCount: _count.groups,
        sorteiosCount:
          sorteios.find((row) => row.ownerId === user.id)?._count._all ?? 0,
      })),
      total,
      query,
    );
  }, snapshotOptions);

export const listAdminGroups = (query: GroupsQuery) =>
  prisma.$transaction(async (transaction) => {
    const where: Prisma.GroupWhereInput = {
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [groups, total] = await Promise.all([
      transaction.group.findMany({
        where,
        ...pagination(query),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true,
          sorteadoAt: true,
          owner: { select: { id: true, name: true, email: true } },
          _count: { select: { participants: true } },
        },
      }),
      transaction.group.count({ where }),
    ]);
    const revealed =
      groups.length === 0
        ? []
        : await transaction.participant.groupBy({
            by: ['groupId'],
            where: {
              groupId: { in: groups.map((group) => group.id) },
              accesses: { some: { revealedAt: { not: null } } },
            },
            _count: { _all: true },
          });
    return pageResult(
      groups.map(({ _count, ...group }) => ({
        ...group,
        participantsCount: _count.participants,
        revealedCount:
          revealed.find((row) => row.groupId === group.id)?._count._all ?? 0,
      })),
      total,
      query,
    );
  }, snapshotOptions);

export const listAuditEvents = (query: AuditQuery) =>
  prisma.$transaction(async (transaction) => {
    const where: Prisma.AuditEventWhereInput = {
      occurredAt: dateFilter(query.period),
      type: query.type,
      actorUserId: query.actorUserId,
      groupId: query.groupId,
    };
    const [items, total] = await Promise.all([
      transaction.auditEvent.findMany({
        where,
        ...pagination(query),
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          type: true,
          occurredAt: true,
          actorUserId: true,
          actorName: true,
          groupId: true,
          groupName: true,
        },
      }),
      transaction.auditEvent.count({ where }),
    ]);
    return {
      ...pageResult(items, total, query),
      period: publicPeriod(query.period),
    };
  }, snapshotOptions);
