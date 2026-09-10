import { z } from 'zod';

export const groupParamsSchema = z.object({
  groupId: z.string().cuid(),
});
