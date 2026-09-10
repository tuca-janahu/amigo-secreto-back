import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { config } from './config/env.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { groupsRouter } from './modules/groups/groups.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import {
  ownerMessagesRouter,
  participantMessagesRouter,
} from './modules/messages/messages.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { participantsRouter } from './modules/participants/participants.routes.js';
import { participantAccessRouter } from './modules/participant-access/participant-access.routes.js';
import { sorteioRouter } from './modules/sorteio/sorteio.routes.js';
import { restrictionsRouter } from './modules/restrictions/restrictions.routes.js';

export const app: Express = express();

app.set('trust proxy', config.trustProxyHops);
app.disable('x-powered-by');
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      callback(null, origin === undefined || origin === config.frontendOrigin);
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: '100kb' }));

app.use('/auth', authRouter);
app.use('/groups', groupsRouter);
app.use('/groups', participantsRouter);
app.use('/groups', restrictionsRouter);
app.use('/groups', sorteioRouter);
app.use('/groups', notificationsRouter);
app.use('/groups', ownerMessagesRouter);
app.use('/public/participant-access', participantAccessRouter);
app.use('/public/participant-access', participantMessagesRouter);
app.use('/health', healthRouter);

app.use(notFoundHandler);
app.use(errorHandler);
