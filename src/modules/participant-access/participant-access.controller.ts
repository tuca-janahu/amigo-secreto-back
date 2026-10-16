import type { RequestHandler } from 'express';

import { AppError } from '../../lib/app-error.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import {
  participantAccessGroupParamsSchema,
  participantAccessParamsSchema,
} from './participant-access.schemas.js';
import {
  claimParticipantAccess,
  getParticipantAccess,
  revealLinkedParticipantAccess,
  revealParticipantAccess,
} from './participant-access.service.js';

const getAuthenticatedUserId = (request: AuthenticatedRequest): string =>
  request.auth.userId;

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

export const claim: RequestHandler = async (request, response, next) => {
  try {
    const participation = await claimParticipantAccess(
      parseToken(request.params),
      getAuthenticatedUserId(request as AuthenticatedRequest),
    );
    response.status(200).json({ participation });
  } catch (error) {
    next(error);
  }
};

export const revealLinked: RequestHandler = async (request, response, next) => {
  try {
    const parsedParams = participantAccessGroupParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError(400, 'ID do grupo inválido.');
    }

    response.status(200).json(
      await revealLinkedParticipantAccess(
        parsedParams.data.groupId,
        getAuthenticatedUserId(request as AuthenticatedRequest),
      ),
    );
  } catch (error) {
    next(error);
  }
};
