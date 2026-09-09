import jwt from 'jsonwebtoken';

import { config } from '../config/env.js';

export const AUTH_COOKIE_NAME = 'auth_token';
export const AUTH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const createAuthToken = (userId: string): string =>
  jwt.sign({}, config.jwtSecret, {
    subject: userId,
    expiresIn: '7d',
  });

export const getUserIdFromAuthToken = (token: string): string | null => {
  try {
    const payload = jwt.verify(token, config.jwtSecret);

    if (typeof payload === 'string' || typeof payload.sub !== 'string') {
      return null;
    }

    return payload.sub;
  } catch {
    return null;
  }
};
