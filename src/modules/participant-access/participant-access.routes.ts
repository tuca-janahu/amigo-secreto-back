import { Router, type Router as ExpressRouter } from 'express';

import { getAccess, reveal } from './participant-access.controller.js';
import {
  participantAccessRateLimiter,
  revealRateLimiter,
} from '../../middlewares/security.js';

export const participantAccessRouter: ExpressRouter = Router();

participantAccessRouter.get('/:token', participantAccessRateLimiter, getAccess);
participantAccessRouter.post('/:token/reveal', revealRateLimiter, reveal);
