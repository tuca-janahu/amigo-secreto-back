import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  DATABASE_URL: z
    .string()
    .url('DATABASE_URL deve ser uma URL de conexão válida.'),
  FRONTEND_URL: z.string().url('FRONTEND_URL deve ser uma URL válida.'),
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  const issues = parsedEnvironment.error.issues
    .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
}

const environment = parsedEnvironment.data;

export const config = Object.freeze({
  nodeEnv: environment.NODE_ENV,
  port: environment.PORT,
  databaseUrl: environment.DATABASE_URL,
  frontendUrl: environment.FRONTEND_URL,
  isProduction: environment.NODE_ENV === 'production',
});
