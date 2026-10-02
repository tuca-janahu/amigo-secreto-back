import type { RequestHandler } from 'express';

import { AppError } from '../../lib/app-error.js';
import { createFeedbackSchema } from './feedback.schemas.js';
import { submitFeedback } from './feedback.service.js';

export const createFeedback: RequestHandler = async (
  request,
  response,
  next,
) => {
  try {
    const parsedBody = createFeedbackSchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError(400, 'Dados do feedback inválidos.');
    }

    await submitFeedback(parsedBody.data);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
};
