import { z } from 'zod';

import { groupParamsSchema } from '../groups/groups.schemas.js';
import { participantAccessParamsSchema } from '../participant-access/participant-access.schemas.js';

const messageContentSchema = z.string().trim().min(1).max(500);

export const createMessageSchema = z.object({
  content: messageContentSchema,
});

export const participantAccessMessageParamsSchema = participantAccessParamsSchema;

export const groupMessageParamsSchema = groupParamsSchema.extend({
  messageId: z.string().cuid(),
});

export type CreateMessageInput = z.infer<typeof createMessageSchema>;
