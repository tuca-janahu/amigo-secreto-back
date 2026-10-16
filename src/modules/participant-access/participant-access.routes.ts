import { Router, type Router as ExpressRouter } from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import { claim, getAccess, reveal, revealLinked } from './participant-access.controller.js';
import {
  participantAccessRateLimiter,
  requireTrustedOrigin,
  revealRateLimiter,
} from '../../middlewares/security.js';

export const participantAccessRouter: ExpressRouter = Router();
export const linkedParticipantAccessRouter: ExpressRouter = Router();

participantAccessRouter.get('/:token', participantAccessRateLimiter, getAccess);
participantAccessRouter.post(
  '/:token/claim',
  participantAccessRateLimiter,
  requireAuth,
  requireTrustedOrigin,
  claim,
);
participantAccessRouter.post('/:token/reveal', revealRateLimiter, reveal);

linkedParticipantAccessRouter.use(requireAuth, requireTrustedOrigin);
linkedParticipantAccessRouter.post('/:groupId/reveal', revealRateLimiter, revealLinked);
