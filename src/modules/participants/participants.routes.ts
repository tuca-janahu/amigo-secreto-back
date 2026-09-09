import { Router, type Router as ExpressRouter } from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import { create, getById, list, remove, update } from './participants.controller.js';

export const participantsRouter: ExpressRouter = Router();

participantsRouter.use(requireAuth);
participantsRouter.post('/:groupId/participants', create);
participantsRouter.get('/:groupId/participants', list);
participantsRouter.get('/:groupId/participants/:participantId', getById);
participantsRouter.patch('/:groupId/participants/:participantId', update);
participantsRouter.delete('/:groupId/participants/:participantId', remove);
