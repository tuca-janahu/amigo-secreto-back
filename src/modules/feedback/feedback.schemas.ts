import { z } from 'zod';

export const feedbackTypeSchema = z.enum(['BUG', 'SUGGESTION']);

export const feedbackSourceSchema = z.enum([
  'HOME',
  'LOGIN',
  'REGISTER',
  'DASHBOARD',
  'GROUP',
  'PARTICIPANT',
  'OTHER',
]);

export const createFeedbackSchema = z
  .object({
    type: feedbackTypeSchema,
    message: z
      .string()
      .trim()
      .min(5, 'Descreva o feedback em pelo menos 5 caracteres.')
      .max(2_000, 'O feedback deve ter no máximo 2.000 caracteres.'),
    source: feedbackSourceSchema,
  })
  .strict();

export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;
