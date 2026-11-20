import { Router, type Router as ExpressRouter } from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import { requireAdmin } from './admin.access.js';
import {
  auditEvents,
  groups,
  overview,
  timeseries,
  users,
} from './admin.controller.js';

export const adminRouter: ExpressRouter = Router();

adminRouter.use((_request, response, next) => {
  response.set('Cache-Control', 'no-store');
  next();
});
adminRouter.use(requireAuth, requireAdmin);
adminRouter.get('/overview', overview);
adminRouter.get('/timeseries', timeseries);
adminRouter.get('/users', users);
adminRouter.get('/groups', groups);
adminRouter.get('/audit-events', auditEvents);
