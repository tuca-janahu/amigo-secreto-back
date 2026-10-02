import { Router, type Router as ExpressRouter } from 'express';

import {
  feedbackRateLimiter,
  requireTrustedOrigin,
} from '../../middlewares/security.js';
import { createFeedback } from './feedback.controller.js';

export const feedbackRouter: ExpressRouter = Router();

feedbackRouter.post(
  '/',
  feedbackRateLimiter,
  requireTrustedOrigin,
  createFeedback,
);
