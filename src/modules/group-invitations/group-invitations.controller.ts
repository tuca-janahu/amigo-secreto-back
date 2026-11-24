import type { RequestHandler } from 'express';

import { AppError } from '../../lib/app-error.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import {
  emptyInvitationBodySchema,
  invitationGroupParamsSchema,
  invitationTokenParamsSchema,
} from './group-invitations.schemas.js';
import {
  deleteGroupInvitation,
  getGroupInvitation,
  invitationNotFoundError,
  joinGroupInvitation,
  previewGroupInvitation,
  replaceGroupInvitation,
} from './group-invitations.service.js';

const parseGroupId = (params: unknown): string => {
  const parsed = invitationGroupParamsSchema.safeParse(params);
  if (!parsed.success) throw new AppError(400, 'ID do grupo inválido.');
  return parsed.data.groupId;
};

const parseToken = (params: unknown): string => {
  const parsed = invitationTokenParamsSchema.safeParse(params);
  if (!parsed.success) throw invitationNotFoundError();
  return parsed.data.token;
};

const ensureEmptyBody = (body: unknown): void => {
  if (!emptyInvitationBodySchema.safeParse(body).success) {
    throw new AppError(400, 'Dados da requisição inválidos.');
  }
};

export const getInvitation: RequestHandler = async (
  request,
  response,
  next,
) => {
  try {
    const invitation = await getGroupInvitation(
      parseGroupId(request.params),
      (request as AuthenticatedRequest).auth.userId,
    );
    response.status(200).json({ invitation });
  } catch (error) {
    next(error);
  }
};

export const replaceInvitation: RequestHandler = async (
  request,
  response,
  next,
) => {
  try {
    ensureEmptyBody(request.body);
    const invitation = await replaceGroupInvitation(
      parseGroupId(request.params),
      (request as AuthenticatedRequest).auth.userId,
    );
    response.status(200).json({ invitation });
  } catch (error) {
    next(error);
  }
};

export const removeInvitation: RequestHandler = async (
  request,
  response,
  next,
) => {
  try {
    ensureEmptyBody(request.body);
    await deleteGroupInvitation(
      parseGroupId(request.params),
      (request as AuthenticatedRequest).auth.userId,
    );
    response.sendStatus(204);
  } catch (error) {
    next(error);
  }
};

export const preview: RequestHandler = async (request, response, next) => {
  try {
    response
      .status(200)
      .json(await previewGroupInvitation(parseToken(request.params)));
  } catch (error) {
    next(error);
  }
};

export const join: RequestHandler = async (request, response, next) => {
  try {
    ensureEmptyBody(request.body);
    const participation = await joinGroupInvitation(
      parseToken(request.params),
      (request as AuthenticatedRequest).auth.userId,
    );
    response.status(200).json({ participation });
  } catch (error) {
    next(error);
  }
};
