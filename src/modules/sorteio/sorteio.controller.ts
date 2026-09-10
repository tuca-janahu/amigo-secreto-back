import type { RequestHandler } from 'express';

import { AppError } from '../../lib/app-error.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { sendInitialInvitations } from '../notifications/notifications.service.js';
import { groupParamsSchema } from './sorteio.schemas.js';
import { getSorteioViability, sortearGrupo } from './sorteio.service.js';

const getAuthenticatedUserId = (request: AuthenticatedRequest): string =>
  request.auth.userId;

const parseGroupId = (params: unknown): string => {
  const parsedParams = groupParamsSchema.safeParse(params);

  if (!parsedParams.success) {
    throw new AppError(400, 'ID do grupo inválido.');
  }

  return parsedParams.data.groupId;
};

export const viability: RequestHandler = async (request, response, next) => {
  try {
    const result = await getSorteioViability(
      parseGroupId(request.params),
      getAuthenticatedUserId(request as AuthenticatedRequest),
    );

    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const sorteio: RequestHandler = async (request, response, next) => {
  try {
    const { group, participantAccessTokens } = await sortearGrupo(
      parseGroupId(request.params),
      getAuthenticatedUserId(request as AuthenticatedRequest),
    );

    // O sorteio já foi persistido; falhas do provedor de e-mail não invalidam a operação.
    await sendInitialInvitations(group.id, participantAccessTokens).catch(() => undefined);

    response.status(200).json({ group });
  } catch (error) {
    next(error);
  }
};
