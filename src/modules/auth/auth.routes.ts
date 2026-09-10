import { Router, type Router as ExpressRouter } from 'express';

import {
  getCurrentUser,
  login,
  logout,
  register,
} from './auth.controller.js';
import { requireAuth } from './auth.middleware.js';
import {
  authRateLimiter,
  requireTrustedOrigin,
} from '../../middlewares/security.js';

export const authRouter: ExpressRouter = Router();

authRouter.post('/register', authRateLimiter, requireTrustedOrigin, register);
authRouter.post('/login', authRateLimiter, requireTrustedOrigin, login);
authRouter.get('/me', requireAuth, getCurrentUser);
authRouter.post('/logout', requireTrustedOrigin, logout);
