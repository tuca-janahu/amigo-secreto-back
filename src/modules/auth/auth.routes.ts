import { Router, type Router as ExpressRouter } from 'express';

import {
  getCurrentUser,
  login,
  logout,
  register,
} from './auth.controller.js';
import { requireAuth } from './auth.middleware.js';

export const authRouter: ExpressRouter = Router();

authRouter.post('/register', register);
authRouter.post('/login', login);
authRouter.get('/me', requireAuth, getCurrentUser);
authRouter.post('/logout', logout);
