import type { RequestHandler } from 'express';

import { AppError } from '../../lib/app-error.js';
import { participantAccessParamsSchema } from './participant-access.schemas.js';
import {
  getParticipantAccess,
  revealParticipantAccess,
} from './participant-access.service.js';

const parseToken = (params: unknown): string => {
  const parsedParams = participantAccessParamsSchema.safeParse(params);

  if (!parsedParams.success) {
    throw new AppError(404, 'Acesso do participante não encontrado.');
  }

  return parsedParams.data.token;
};

export const getAccess: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json(await getParticipantAccess(parseToken(request.params)));
  } catch (error) {
    next(error);
  }
};

export const reveal: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json(await revealParticipantAccess(parseToken(request.params)));
  } catch (error) {
    next(error);
  }
};
