import { Router, type Router as ExpressRouter } from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import { create, getById, list, remove, update } from './groups.controller.js';

export const groupsRouter: ExpressRouter = Router();

groupsRouter.use(requireAuth);
groupsRouter.post('/', create);
groupsRouter.get('/', list);
groupsRouter.get('/:groupId', getById);
groupsRouter.patch('/:groupId', update);
groupsRouter.delete('/:groupId', remove);
