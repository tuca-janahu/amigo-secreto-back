import { z } from 'zod';

const groupNameSchema = z.string().trim().min(1).max(100);

export const createGroupSchema = z.object({
  name: groupNameSchema,
});

export const updateGroupSchema = z.object({
  name: groupNameSchema,
});

export const groupParamsSchema = z.object({
  groupId: z.string().cuid(),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
