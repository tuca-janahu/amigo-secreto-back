import type { RequestHandler } from 'express';

import { AppError } from '../../lib/app-error.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import {
  createGroupSchema,
  groupParamsSchema,
  updateGroupSchema,
} from './groups.schemas.js';
import {
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  renameGroup,
} from './groups.service.js';

const getAuthenticatedUserId = (request: AuthenticatedRequest): string =>
  request.auth.userId;

const parseGroupId = (params: unknown): string => {
  const parsedParams = groupParamsSchema.safeParse(params);

  if (!parsedParams.success) {
    throw new AppError(400, 'Invalid group id.');
  }

  return parsedParams.data.groupId;
};

export const create: RequestHandler = async (request, response, next) => {
  try {
    const parsedBody = createGroupSchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError(400, 'Invalid request data.');
    }

    const group = await createGroup(
      getAuthenticatedUserId(request as AuthenticatedRequest),
      parsedBody.data,
    );

    response.status(201).json({ group });
  } catch (error) {
    next(error);
  }
};

export const list: RequestHandler = async (request, response, next) => {
  try {
    const groups = await listGroups(
      getAuthenticatedUserId(request as AuthenticatedRequest),
    );

    response.status(200).json({ groups });
  } catch (error) {
    next(error);
  }
};

export const getById: RequestHandler = async (request, response, next) => {
  try {
    const group = await getGroup(
      parseGroupId(request.params),
      getAuthenticatedUserId(request as AuthenticatedRequest),
    );

    response.status(200).json({ group });
  } catch (error) {
    next(error);
  }
};

export const update: RequestHandler = async (request, response, next) => {
  try {
    const parsedBody = updateGroupSchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError(400, 'Invalid request data.');
    }

    const group = await renameGroup(
      parseGroupId(request.params),
      getAuthenticatedUserId(request as AuthenticatedRequest),
      parsedBody.data,
    );

    response.status(200).json({ group });
  } catch (error) {
    next(error);
  }
};

export const remove: RequestHandler = async (request, response, next) => {
  try {
    await deleteGroup(
      parseGroupId(request.params),
      getAuthenticatedUserId(request as AuthenticatedRequest),
    );

    response.status(204).send();
  } catch (error) {
    next(error);
  }
};
