import { Router, type Router as ExpressRouter } from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import { requireTrustedOrigin } from '../../middlewares/security.js';
import { create, getById, list, remove, update } from './groups.controller.js';

export const groupsRouter: ExpressRouter = Router();

groupsRouter.use(requireAuth, requireTrustedOrigin);
groupsRouter.post('/', create);
groupsRouter.get('/', list);
groupsRouter.get('/:groupId', getById);
groupsRouter.patch('/:groupId', update);
groupsRouter.delete('/:groupId', remove);
