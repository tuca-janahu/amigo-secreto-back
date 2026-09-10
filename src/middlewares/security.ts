import type { RequestHandler } from 'express';
import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';

import { config } from '../config/env.js';
import { AppError } from '../lib/app-error.js';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

const createRateLimiter = (
  limit: number,
  message: string,
): RateLimitRequestHandler =>
  rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message },
  });

export const authRateLimiter = createRateLimiter(
  10,
  'Muitas tentativas. Tente novamente em alguns minutos.',
);

export const participantAccessRateLimiter = createRateLimiter(
  60,
  'Muitas tentativas de acesso. Tente novamente em alguns minutos.',
);

export const revealRateLimiter = createRateLimiter(
  30,
  'Muitas tentativas de revelação. Tente novamente em alguns minutos.',
);

export const messageCreationRateLimiter = createRateLimiter(
  20,
  'Limite de mensagens atingido. Tente novamente em alguns minutos.',
);

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

export const requireTrustedOrigin: RequestHandler = (request, _response, next) => {
  if (!MUTATING_METHODS.has(request.method)) {
    next();
    return;
  }

  const origin = request.get('origin');

  // Origin ausente mantém compatibilidade com clientes não executados em navegador.
  if (origin && origin !== config.frontendOrigin) {
    next(new AppError(403, 'Origem não permitida.'));
    return;
  }

  next();
};
