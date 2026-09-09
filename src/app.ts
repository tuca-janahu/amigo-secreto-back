import cors from 'cors';
import express, { type Express } from 'express';

import { config } from './config/env.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { healthRouter } from './modules/health/health.routes.js';

export const app: Express = express();

app.disable('x-powered-by');
app.use(express.json());
app.use(cors({ origin: config.frontendUrl }));

app.use('/health', healthRouter);

app.use(notFoundHandler);
app.use(errorHandler);
