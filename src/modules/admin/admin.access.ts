import type { RequestHandler } from 'express';

import { config } from '../../config/env.js';
import { AppError } from '../../lib/app-error.js';
import { getUserById } from '../auth/auth.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';

export const isAdminUser = (userId: string): boolean =>
  config.adminUserIds.includes(userId);

export const requireAdmin: RequestHandler = async (
  request,
  _response,
  next,
) => {
  try {
    const { userId } = (request as AuthenticatedRequest).auth;
    const user = await getUserById(userId);

    if (!user) {
      throw new AppError(401, 'Não autorizado.');
    }
    if (!isAdminUser(user.id)) {
      throw new AppError(403, 'Acesso restrito a administradores.');
    }
    next();
  } catch (error) {
    next(error);
  }
};
