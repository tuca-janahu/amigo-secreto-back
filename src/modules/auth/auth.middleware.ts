import type { RequestHandler } from 'express';

import {
  AUTH_COOKIE_NAME,
  getUserIdFromAuthToken,
} from '../../lib/auth-token.js';
import { AppError } from '../../lib/app-error.js';
import type { AuthenticatedRequest } from './auth.types.js';

const getCookieValue = (cookieHeader: string | undefined): string | undefined => {
  if (!cookieHeader) {
    return undefined;
  }

  const cookie = cookieHeader
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${AUTH_COOKIE_NAME}=`));

  return cookie?.slice(AUTH_COOKIE_NAME.length + 1);
};

export const requireAuth: RequestHandler = (request, _response, next) => {
  const token = getCookieValue(request.headers.cookie);
  const userId = token ? getUserIdFromAuthToken(token) : null;

  if (!userId) {
    next(new AppError(401, 'Não autorizado.'));
    return;
  }

  (request as AuthenticatedRequest).auth = { userId };
  next();
};
