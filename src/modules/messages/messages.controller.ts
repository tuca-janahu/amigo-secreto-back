import type { RequestHandler } from 'express';

import { AppError } from '../../lib/app-error.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import {
  createMessageSchema,
  groupMessageParamsSchema,
  participantAccessMessageParamsSchema,
} from './messages.schemas.js';
import {
  createParticipantMessage,
  deleteOwnerMessage,
  listOwnerMessages,
  listParticipantMessages,
} from './messages.service.js';

const getAuthenticatedUserId = (request: AuthenticatedRequest): string =>
  request.auth.userId;

const parseToken = (params: unknown): string => {
  const parsedParams = participantAccessMessageParamsSchema.safeParse(params);

  if (!parsedParams.success) {
    throw new AppError(404, 'Acesso do participante não encontrado.');
  }

  return parsedParams.data.token;
};

const parseGroupId = (params: unknown): string => {
  const parsedParams = groupMessageParamsSchema.pick({ groupId: true }).safeParse(params);

  if (!parsedParams.success) {
    throw new AppError(400, 'ID do grupo inválido.');
  }

  return parsedParams.data.groupId;
};

const parseMessageParams = (params: unknown) => {
  const parsedParams = groupMessageParamsSchema.safeParse(params);

  if (!parsedParams.success) {
    throw new AppError(400, 'Parâmetros da mensagem inválidos.');
  }

  return parsedParams.data;
};

export const listForParticipant: RequestHandler = async (request, response, next) => {
  try {
    const messages = await listParticipantMessages(parseToken(request.params));
    response.status(200).json({ messages });
  } catch (error) {
    next(error);
  }
};

export const createForParticipant: RequestHandler = async (request, response, next) => {
  try {
    const parsedBody = createMessageSchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError(400, 'Dados da requisição inválidos.');
    }

    const message = await createParticipantMessage(
      parseToken(request.params),
      parsedBody.data,
    );
    response.status(201).json({ message });
  } catch (error) {
    next(error);
  }
};

export const listForOwner: RequestHandler = async (request, response, next) => {
  try {
    const messages = await listOwnerMessages(
      parseGroupId(request.params),
      getAuthenticatedUserId(request as AuthenticatedRequest),
    );
    response.status(200).json({ messages });
  } catch (error) {
    next(error);
  }
};

export const removeForOwner: RequestHandler = async (request, response, next) => {
  try {
    const { groupId, messageId } = parseMessageParams(request.params);
    await deleteOwnerMessage(
      groupId,
      messageId,
      getAuthenticatedUserId(request as AuthenticatedRequest),
    );
    response.status(204).send();
  } catch (error) {
    next(error);
  }
};
