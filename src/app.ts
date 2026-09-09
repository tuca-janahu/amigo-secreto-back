import cors from 'cors';
import express, { type Express } from 'express';

import { config } from './config/env.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { groupsRouter } from './modules/groups/groups.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { participantsRouter } from './modules/participants/participants.routes.js';

export const app: Express = express();

app.disable('x-powered-by');
app.use(express.json());
app.use(cors({ origin: config.frontendUrl, credentials: true }));

app.use('/auth', authRouter);
app.use('/groups', groupsRouter);
app.use('/groups', participantsRouter);
app.use('/health', healthRouter);

app.use(notFoundHandler);
app.use(errorHandler);
