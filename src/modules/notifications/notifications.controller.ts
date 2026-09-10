import type { RequestHandler } from 'express';

import { AppError } from '../../lib/app-error.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import {
  invitationGroupParamsSchema,
  invitationParticipantParamsSchema,
} from './notifications.schemas.js';
import {
  listInvitationStatuses,
  resendInvitation,
  resendPendingInvitations,
} from './notifications.service.js';

const getAuthenticatedUserId = (request: AuthenticatedRequest): string =>
  request.auth.userId;

const parseGroupId = (params: unknown): string => {
  const parsedParams = invitationGroupParamsSchema.safeParse(params);

  if (!parsedParams.success) {
    throw new AppError(400, 'ID do grupo inválido.');
  }

  return parsedParams.data.groupId;
};

const parseParticipantParams = (params: unknown) => {
  const parsedParams = invitationParticipantParamsSchema.safeParse(params);

  if (!parsedParams.success) {
    throw new AppError(400, 'Parâmetros do convite inválidos.');
  }

  return parsedParams.data;
};

export const resend: RequestHandler = async (request, response, next) => {
  try {
    const { groupId, participantId } = parseParticipantParams(request.params);
    const status = await resendInvitation(
      groupId,
      participantId,
      getAuthenticatedUserId(request as AuthenticatedRequest),
    );

    response.status(200).json({ status });
  } catch (error) {
    next(error);
  }
};

export const resendPending: RequestHandler = async (request, response, next) => {
  try {
    const result = await resendPendingInvitations(
      parseGroupId(request.params),
      getAuthenticatedUserId(request as AuthenticatedRequest),
    );

    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const listStatuses: RequestHandler = async (request, response, next) => {
  try {
    const participants = await listInvitationStatuses(
      parseGroupId(request.params),
      getAuthenticatedUserId(request as AuthenticatedRequest),
    );

    response.status(200).json({ participants });
  } catch (error) {
    next(error);
  }
};
