import { Router, type Router as ExpressRouter } from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import {
  createForParticipant,
  listForOwner,
  listForParticipant,
  removeForOwner,
} from './messages.controller.js';

export const participantMessagesRouter: ExpressRouter = Router();
export const ownerMessagesRouter: ExpressRouter = Router();

participantMessagesRouter.get('/:token/messages', listForParticipant);
participantMessagesRouter.post('/:token/messages', createForParticipant);

ownerMessagesRouter.use(requireAuth);
ownerMessagesRouter.get('/:groupId/messages', listForOwner);
ownerMessagesRouter.delete('/:groupId/messages/:messageId', removeForOwner);
