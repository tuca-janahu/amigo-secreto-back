import { Router, type Router as ExpressRouter } from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import { create, createBilateral, list, remove } from './restrictions.controller.js';

export const restrictionsRouter: ExpressRouter = Router();

restrictionsRouter.use(requireAuth);
restrictionsRouter.post('/:groupId/restrictions/bilateral', createBilateral);
restrictionsRouter.post('/:groupId/restrictions', create);
restrictionsRouter.get('/:groupId/restrictions', list);
restrictionsRouter.delete('/:groupId/restrictions/:restrictionId', remove);
