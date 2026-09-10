import { z } from 'zod';

export const participantAccessParamsSchema = z.object({
  token: z.string().min(1),
});
