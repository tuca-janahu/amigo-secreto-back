import { AppError } from '../../lib/app-error.js';
import { sendFeedbackEmail } from './feedback-email.service.js';
import type { CreateFeedbackInput } from './feedback.schemas.js';

export const submitFeedback = async (
  feedback: CreateFeedbackInput,
): Promise<void> => {
  try {
    await sendFeedbackEmail(feedback);
  } catch {
    throw new AppError(502, 'Não foi possível enviar o feedback.');
  }
};
