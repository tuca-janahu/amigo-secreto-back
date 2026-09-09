import { z } from 'zod';

const participantNameSchema = z.string().trim().min(1).max(150);
const participantEmailSchema = z.string().trim().toLowerCase().email().max(254);

export const createParticipantSchema = z.object({
  name: participantNameSchema,
  email: participantEmailSchema,
});

export const updateParticipantSchema = z
  .object({
    name: participantNameSchema.optional(),
    email: participantEmailSchema.optional(),
  })
  .refine((input) => input.name !== undefined || input.email !== undefined);

export const groupParamsSchema = z.object({
  groupId: z.string().cuid(),
});

export const participantParamsSchema = groupParamsSchema.extend({
  participantId: z.string().cuid(),
});

export type CreateParticipantInput = z.infer<typeof createParticipantSchema>;
export type UpdateParticipantInput = z.infer<typeof updateParticipantSchema>;
