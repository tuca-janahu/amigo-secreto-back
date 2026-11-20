import { AuditEventType, GroupStatus } from '@prisma/client';
import { z } from 'zod';

export const ADMIN_TIME_ZONE = 'America/Sao_Paulo';
const DAY_MS = 86_400_000;
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ADMIN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const localDate = (date: Date): string => {
  const parts = dayFormatter.formatToParts(date);
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-');
};

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

// Find the first instant of the local date, including historical DST transitions.
const startOfLocalDay = (date: string): Date => {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  let low = utcMidnight - DAY_MS;
  let high = utcMidnight + DAY_MS;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (localDate(new Date(middle)) < date) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
};

const dateSchema = z
  .string()
  .date()
  .refine(
    (value) => value >= '1970-01-01' && value <= '9999-12-30',
    'A data deve estar entre 1970-01-01 e 9999-12-30.',
  );
const periodFields = { from: dateSchema.optional(), to: dateSchema.optional() };

export const periodSchema = z
  .object(periodFields)
  .transform(({ from, to }) => {
    const end = to ?? localDate(new Date());
    return { from: from ?? addDays(end, -29), to: end };
  })
  .superRefine(({ from, to }, context) => {
    const days = (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
    if (days < 1 || days > 90) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'O período deve conter de 1 a 90 dias.',
      });
    }
  })
  .transform(({ from, to }) => ({
    from,
    to,
    timeZone: ADMIN_TIME_ZONE,
    start: startOfLocalDay(from),
    end: startOfLocalDay(addDays(to, 1)),
  }));

const pageFields = {
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};
const idSchema = z.string().trim().min(1).max(128);
const searchSchema = z.string().trim().min(1).max(100).optional();

export const dashboardQuerySchema = z
  .object(periodFields)
  .strict()
  .pipe(periodSchema);

export const usersQuerySchema = z
  .object({ ...pageFields, q: searchSchema })
  .strict();
export const groupsQuerySchema = z
  .object({
    ...pageFields,
    q: searchSchema,
    ownerId: idSchema.optional(),
    status: z.nativeEnum(GroupStatus).optional(),
  })
  .strict();
export const auditQuerySchema = z
  .object({
    ...pageFields,
    type: z.nativeEnum(AuditEventType).optional(),
    actorUserId: idSchema.optional(),
    groupId: idSchema.optional(),
    ...periodFields,
  })
  .strict()
  .transform(({ from, to, ...filters }, context) => {
    const period = periodSchema.safeParse({ from, to });
    if (!period.success) {
      period.error.issues.forEach((issue) => context.addIssue(issue));
      return z.NEVER;
    }
    return { ...filters, period: period.data };
  });

export type AdminPeriod = z.infer<typeof periodSchema>;
export type UsersQuery = z.infer<typeof usersQuerySchema>;
export type GroupsQuery = z.infer<typeof groupsQuerySchema>;
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const publicPeriod = ({ from, to, timeZone }: AdminPeriod) => ({
  from,
  to,
  timeZone,
});
