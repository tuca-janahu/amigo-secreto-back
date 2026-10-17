import { Router, type Router as ExpressRouter } from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import { requireTrustedOrigin } from '../../middlewares/security.js';
import {
  create,
  getById,
  list,
  remove,
  syncParticipations,
  update,
} from './groups.controller.js';

export const groupsRouter: ExpressRouter = Router();

groupsRouter.use(requireAuth, requireTrustedOrigin);
groupsRouter.post('/', create);
groupsRouter.post('/sync-owner-participations', syncParticipations);
groupsRouter.get('/', list);
groupsRouter.get('/:groupId', getById);
groupsRouter.patch('/:groupId', update);
groupsRouter.delete('/:groupId', remove);
