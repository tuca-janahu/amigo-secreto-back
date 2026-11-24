import {
  Router,
  type RequestHandler,
  type Router as ExpressRouter,
} from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import {
  groupInvitationJoinRateLimiter,
  groupInvitationPreviewRateLimiter,
  requireTrustedOrigin,
} from '../../middlewares/security.js';
import {
  getInvitation,
  join,
  preview,
  removeInvitation,
  replaceInvitation,
} from './group-invitations.controller.js';

export const groupInvitationNoStore: RequestHandler = (
  _request,
  response,
  next,
) => {
  response.setHeader('Cache-Control', 'no-store');
  next();
};

export const ownerGroupInvitationsRouter: ExpressRouter = Router();
export const publicGroupInvitationsRouter: ExpressRouter = Router();

ownerGroupInvitationsRouter
  .route('/:groupId/invitation')
  .all(requireAuth, requireTrustedOrigin)
  .get(getInvitation)
  .post(replaceInvitation)
  .delete(removeInvitation);

publicGroupInvitationsRouter.get(
  '/:token',
  groupInvitationPreviewRateLimiter,
  preview,
);
publicGroupInvitationsRouter.post(
  '/:token/join',
  groupInvitationJoinRateLimiter,
  requireAuth,
  requireTrustedOrigin,
  join,
);
