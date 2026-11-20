import type { RequestHandler } from 'express';
import type { z } from 'zod';

import { AppError } from '../../lib/app-error.js';
import {
  auditQuerySchema,
  dashboardQuerySchema,
  groupsQuerySchema,
  usersQuerySchema,
} from './admin.schemas.js';
import {
  getOverview,
  getTimeseries,
  listAdminGroups,
  listAdminUsers,
  listAuditEvents,
} from './admin.service.js';

const queryHandler =
  <Schema extends z.ZodTypeAny>(
    schema: Schema,
    service: (query: z.output<Schema>) => Promise<unknown>,
  ): RequestHandler =>
  async (request, response, next) => {
    try {
      const parsed = schema.safeParse(request.query);
      if (!parsed.success) {
        throw new AppError(400, 'Filtros da requisição inválidos.');
      }
      response.status(200).json(await service(parsed.data));
    } catch (error) {
      next(error);
    }
  };

export const overview: RequestHandler = queryHandler(
  dashboardQuerySchema,
  getOverview,
);
export const timeseries: RequestHandler = queryHandler(
  dashboardQuerySchema,
  getTimeseries,
);
export const users: RequestHandler = queryHandler(
  usersQuerySchema,
  listAdminUsers,
);
export const groups: RequestHandler = queryHandler(
  groupsQuerySchema,
  listAdminGroups,
);
export const auditEvents: RequestHandler = queryHandler(
  auditQuerySchema,
  listAuditEvents,
);
