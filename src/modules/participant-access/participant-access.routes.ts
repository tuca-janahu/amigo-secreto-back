import { Router, type Router as ExpressRouter } from 'express';

import { getAccess, reveal } from './participant-access.controller.js';

export const participantAccessRouter: ExpressRouter = Router();

participantAccessRouter.get('/:token', getAccess);
participantAccessRouter.post('/:token/reveal', reveal);
