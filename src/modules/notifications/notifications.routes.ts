import { Router, type Router as ExpressRouter } from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import { requireTrustedOrigin } from '../../middlewares/security.js';
import { listStatuses, resend, resendPending } from './notifications.controller.js';

export const notificationsRouter: ExpressRouter = Router();

notificationsRouter.use(requireAuth, requireTrustedOrigin);
notificationsRouter.post('/:groupId/participants/:participantId/invite/resend', resend);
notificationsRouter.post('/:groupId/invitations/resend-pending', resendPending);
notificationsRouter.get('/:groupId/invitations', listStatuses);
