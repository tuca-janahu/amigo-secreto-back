import type { CookieOptions, RequestHandler } from 'express';

import { config } from '../../config/env.js';
import {
  AUTH_COOKIE_NAME,
  AUTH_TOKEN_MAX_AGE_MS,
  createAuthToken,
} from '../../lib/auth-token.js';
import { AppError } from '../../lib/app-error.js';
import { credentialsSchema, registrationSchema } from './auth.schemas.js';
import {
  authenticateUser,
  getUserById,
  registerUser,
} from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';

const authCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProduction,
  path: '/',
};

const getCredentials = (body: unknown) => {
  const parsedCredentials = credentialsSchema.safeParse(body);

  if (!parsedCredentials.success) {
    throw new AppError(400, 'Invalid request data.');
  }

  return parsedCredentials.data;
};

const getRegistrationData = (body: unknown) => {
  const parsedRegistration = registrationSchema.safeParse(body);

  if (!parsedRegistration.success) {
    throw new AppError(400, 'Invalid request data.');
  }

  return parsedRegistration.data;
};

const setAuthCookie = (response: Parameters<RequestHandler>[1], userId: string) => {
  response.cookie(AUTH_COOKIE_NAME, createAuthToken(userId), {
    ...authCookieOptions,
    maxAge: AUTH_TOKEN_MAX_AGE_MS,
  });
};

export const register: RequestHandler = async (request, response, next) => {
  try {
    const user = await registerUser(getRegistrationData(request.body));

    response.status(201).json({ user });
  } catch (error) {
    next(error);
  }
};

export const login: RequestHandler = async (request, response, next) => {
  try {
    const user = await authenticateUser(getCredentials(request.body));

    setAuthCookie(response, user.id);
    response.status(200).json({ user });
  } catch (error) {
    next(error);
  }
};

export const getCurrentUser: RequestHandler = async (
  request,
  response,
  next,
) => {
  try {
    const { userId } = (request as AuthenticatedRequest).auth;
    const user = await getUserById(userId);

    if (!user) {
      throw new AppError(401, 'Unauthorized.');
    }

    response.status(200).json({ user });
  } catch (error) {
    next(error);
  }
};

export const logout: RequestHandler = (_request, response) => {
  response.clearCookie(AUTH_COOKIE_NAME, authCookieOptions);
  response.status(204).send();
};
