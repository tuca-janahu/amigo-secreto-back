import { Router, type Router as ExpressRouter } from 'express';

import { getHealth } from './health.controller.js';

export const healthRouter: ExpressRouter = Router();

healthRouter.get('/', getHealth);
