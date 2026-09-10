import { Router, type Router as ExpressRouter } from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import { requireTrustedOrigin } from '../../middlewares/security.js';
import { sorteio, viability } from './sorteio.controller.js';

export const sorteioRouter: ExpressRouter = Router();

sorteioRouter.use(requireAuth, requireTrustedOrigin);
sorteioRouter.get('/:groupId/sorteio/viability', viability);
sorteioRouter.post('/:groupId/sorteio', sorteio);
