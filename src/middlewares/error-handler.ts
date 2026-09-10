import type { ErrorRequestHandler, RequestHandler } from 'express';

import { AppError } from '../lib/app-error.js';

export const notFoundHandler: RequestHandler = (_request, _response, next) => {
  next(new AppError(404, 'Rota não encontrada.'));
};

const isBodyParserError = (
  error: unknown,
): error is { status: number; type?: string } =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  typeof error.status === 'number';

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
  const isRequestBodyError = isBodyParserError(error) && error.status < 500;
  const statusCode = isExpectedError
    ? error.statusCode
    : isRequestBodyError
      ? error.status
      : 500;
  const message = isExpectedError
    ? error.message
    : isRequestBodyError && error.type === 'entity.too.large'
      ? 'Corpo da requisição excede o limite permitido.'
      : isRequestBodyError
        ? 'Corpo da requisição inválido.'
        : 'Erro interno do servidor.';

  response.status(statusCode).json(
    isExpectedError && error.code ? { error: error.code } : { message },
  );
};
