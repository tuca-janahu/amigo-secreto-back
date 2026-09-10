import { z } from 'zod';

import { groupParamsSchema } from '../groups/groups.schemas.js';

export const invitationParticipantParamsSchema = groupParamsSchema.extend({
  participantId: z.string().cuid(),
});

export const invitationGroupParamsSchema = groupParamsSchema;
