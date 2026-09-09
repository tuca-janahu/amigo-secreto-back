import { z } from 'zod';

const participantIdSchema = z.string().cuid();

export const groupParamsSchema = z.object({
  groupId: z.string().cuid(),
});

export const restrictionParamsSchema = groupParamsSchema.extend({
  restrictionId: z.string().cuid(),
});

export const createRestrictionSchema = z.object({
  giverParticipantId: participantIdSchema,
  forbiddenParticipantId: participantIdSchema,
});

export const createBilateralRestrictionSchema = z.object({
  participantAId: participantIdSchema,
  participantBId: participantIdSchema,
});

export type CreateRestrictionInput = z.infer<typeof createRestrictionSchema>;
export type CreateBilateralRestrictionInput = z.infer<
  typeof createBilateralRestrictionSchema
>;
