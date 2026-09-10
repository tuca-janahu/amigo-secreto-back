import { Router, type Router as ExpressRouter } from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import { requireTrustedOrigin } from '../../middlewares/security.js';
import {
  create,
  getById,
  importBatch,
  list,
  remove,
  update,
} from './participants.controller.js';

export const participantsRouter: ExpressRouter = Router();

participantsRouter.use(requireAuth, requireTrustedOrigin);
participantsRouter.post('/:groupId/participants/import', importBatch);
participantsRouter.post('/:groupId/participants', create);
participantsRouter.get('/:groupId/participants', list);
participantsRouter.get('/:groupId/participants/:participantId', getById);
participantsRouter.patch('/:groupId/participants/:participantId', update);
participantsRouter.delete('/:groupId/participants/:participantId', remove);
