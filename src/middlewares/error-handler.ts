import type { ErrorRequestHandler, RequestHandler } from 'express';

import { AppError } from '../lib/app-error.js';

export const notFoundHandler: RequestHandler = (_request, _response, next) => {
  next(new AppError(404, 'Route not found.'));
};

export const errorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const isExpectedError = error instanceof AppError;
  const statusCode = isExpectedError ? error.statusCode : 500;
  const message = isExpectedError ? error.message : 'Internal server error.';

  response.status(statusCode).json({ message });
};
