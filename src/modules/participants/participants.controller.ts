import type { RequestHandler } from 'express';

import { AppError } from '../../lib/app-error.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import {
  createParticipantSchema,
  groupParamsSchema,
  importParticipantsSchema,
  participantParamsSchema,
  updateParticipantSchema,
} from './participants.schemas.js';
import {
  createParticipant,
  deleteParticipant,
  getParticipant,
  importParticipants,
  listParticipants,
  updateParticipant,
} from './participants.service.js';

const getAuthenticatedUserId = (request: AuthenticatedRequest): string =>
  request.auth.userId;

const parseGroupId = (params: unknown): string => {
  const parsedParams = groupParamsSchema.safeParse(params);

  if (!parsedParams.success) {
    throw new AppError(400, 'ID do grupo inválido.');
  }

  return parsedParams.data.groupId;
};

const parseParticipantParams = (params: unknown) => {
  const parsedParams = participantParamsSchema.safeParse(params);

  if (!parsedParams.success) {
    throw new AppError(400, 'Parâmetros do participante inválidos.');
  }

  return parsedParams.data;
};

export const create: RequestHandler = async (request, response, next) => {
  try {
    const parsedBody = createParticipantSchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError(400, 'Dados da requisição inválidos.');
    }

    const participant = await createParticipant(
      parseGroupId(request.params),
      getAuthenticatedUserId(request as AuthenticatedRequest),
      parsedBody.data,
    );

    response.status(201).json({ participant });
  } catch (error) {
    next(error);
  }
};

export const list: RequestHandler = async (request, response, next) => {
  try {
    const participants = await listParticipants(
      parseGroupId(request.params),
      getAuthenticatedUserId(request as AuthenticatedRequest),
    );

    response.status(200).json({ participants });
  } catch (error) {
    next(error);
  }
};

export const importBatch: RequestHandler = async (request, response, next) => {
  try {
    const parsedBody = importParticipantsSchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError(400, 'Dados da requisição inválidos.');
    }

    const participants = await importParticipants(
      parseGroupId(request.params),
      getAuthenticatedUserId(request as AuthenticatedRequest),
      parsedBody.data.data,
    );

    response.status(201).json({
      imported: participants.length,
      participants,
    });
  } catch (error) {
    next(error);
  }
};

export const getById: RequestHandler = async (request, response, next) => {
  try {
    const { groupId, participantId } = parseParticipantParams(request.params);
    const participant = await getParticipant(
      groupId,
      participantId,
      getAuthenticatedUserId(request as AuthenticatedRequest),
    );

    response.status(200).json({ participant });
  } catch (error) {
    next(error);
  }
};

export const update: RequestHandler = async (request, response, next) => {
  try {
    const parsedBody = updateParticipantSchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError(400, 'Dados da requisição inválidos.');
    }

    const { groupId, participantId } = parseParticipantParams(request.params);
    const participant = await updateParticipant(
      groupId,
      participantId,
      getAuthenticatedUserId(request as AuthenticatedRequest),
      parsedBody.data,
    );

    response.status(200).json({ participant });
  } catch (error) {
    next(error);
  }
};

export const remove: RequestHandler = async (request, response, next) => {
  try {
    const { groupId, participantId } = parseParticipantParams(request.params);
    await deleteParticipant(
      groupId,
      participantId,
      getAuthenticatedUserId(request as AuthenticatedRequest),
    );

    response.status(204).send();
  } catch (error) {
    next(error);
  }
};
