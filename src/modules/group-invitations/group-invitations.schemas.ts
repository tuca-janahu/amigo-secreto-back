import { z } from 'zod';

export const invitationGroupParamsSchema = z.object({
  groupId: z.string().cuid(),
});

export const invitationTokenParamsSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export const emptyInvitationBodySchema = z.object({}).strict().optional();
