import { z } from 'zod';

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
});

export const registrationSchema = credentialsSchema.extend({
  name: z.string().trim().min(1).max(100),
});

export type Credentials = z.infer<typeof credentialsSchema>;
export type RegistrationInput = z.infer<typeof registrationSchema>;
