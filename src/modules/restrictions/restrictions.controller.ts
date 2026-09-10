import type { RequestHandler } from 'express';

import { AppError } from '../../lib/app-error.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import {
  createBilateralRestrictionSchema,
  createRestrictionSchema,
  groupParamsSchema,
  restrictionParamsSchema,
} from './restrictions.schemas.js';
import {
  createBilateralRestriction,
  createRestriction,
  deleteRestriction,
  listRestrictions,
} from './restrictions.service.js';

const getAuthenticatedUserId = (request: AuthenticatedRequest): string =>
  request.auth.userId;

const parseGroupId = (params: unknown): string => {
  const parsedParams = groupParamsSchema.safeParse(params);

  if (!parsedParams.success) {
    throw new AppError(400, 'ID do grupo inválido.');
  }

  return parsedParams.data.groupId;
};

const parseRestrictionParams = (params: unknown) => {
  const parsedParams = restrictionParamsSchema.safeParse(params);

  if (!parsedParams.success) {
    throw new AppError(400, 'Parâmetros da restrição inválidos.');
  }

  return parsedParams.data;
};

export const create: RequestHandler = async (request, response, next) => {
  try {
    const parsedBody = createRestrictionSchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError(400, 'Dados da requisição inválidos.');
    }

    const restriction = await createRestriction(
      parseGroupId(request.params),
      getAuthenticatedUserId(request as AuthenticatedRequest),
      parsedBody.data,
    );

    response.status(201).json({ restriction });
  } catch (error) {
    next(error);
  }
};

export const createBilateral: RequestHandler = async (request, response, next) => {
  try {
    const parsedBody = createBilateralRestrictionSchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError(400, 'Dados da requisição inválidos.');
    }

    const restrictions = await createBilateralRestriction(
      parseGroupId(request.params),
      getAuthenticatedUserId(request as AuthenticatedRequest),
      parsedBody.data,
    );

    response.status(201).json({ restrictions });
  } catch (error) {
    next(error);
  }
};

export const list: RequestHandler = async (request, response, next) => {
  try {
    const restrictions = await listRestrictions(
      parseGroupId(request.params),
      getAuthenticatedUserId(request as AuthenticatedRequest),
    );

    response.status(200).json({ restrictions });
  } catch (error) {
    next(error);
  }
};

export const remove: RequestHandler = async (request, response, next) => {
  try {
    const { groupId, restrictionId } = parseRestrictionParams(request.params);
    await deleteRestriction(
      groupId,
      restrictionId,
      getAuthenticatedUserId(request as AuthenticatedRequest),
    );

    response.status(204).send();
  } catch (error) {
    next(error);
  }
};
