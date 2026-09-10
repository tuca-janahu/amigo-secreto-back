import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Normalização dos dados da .env para os tipos corretos e validação de valores obrigatórios
const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  DATABASE_URL: z
    .string()
    .url('DATABASE_URL deve ser uma URL de conexão válida.'),
  FRONTEND_URL: z.string().url('FRONTEND_URL deve ser uma URL válida.'),
  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY deve ser informada.'),
  EMAIL_FROM: z.string().min(1, 'EMAIL_FROM deve ser informado.'),
  APP_URL: z.string().url('APP_URL deve ser uma URL válida.'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter ao menos 32 caracteres.'),
  DATA_ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[A-Za-z0-9+/]{43}=$/,
      'DATA_ENCRYPTION_KEY must be a 32-byte AES-256 key encoded as Base64.',
    )
    .transform((value) => Buffer.from(value, 'base64'))
    .refine(
      (value) => value.length === 32,
      'DATA_ENCRYPTION_KEY must decode to exactly 32 bytes.',
    ),
  SORTEIO_ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[A-Za-z0-9+/]{43}=$/,
      'SORTEIO_ENCRYPTION_KEY must be a 32-byte AES-256 key encoded as Base64.',
    )
    .transform((value) => Buffer.from(value, 'base64'))
    .refine(
      (value) => value.length === 32,
      'SORTEIO_ENCRYPTION_KEY must decode to exactly 32 bytes.',
    ),
  EMAIL_LOOKUP_SECRET: z
    .string()
    .min(32, 'EMAIL_LOOKUP_SECRET must contain at least 32 characters.'),
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
  resendApiKey: environment.RESEND_API_KEY,
  emailFrom: environment.EMAIL_FROM,
  appUrl: environment.APP_URL,
  jwtSecret: environment.JWT_SECRET,
  dataEncryptionKey: environment.DATA_ENCRYPTION_KEY,
  sorteioEncryptionKey: environment.SORTEIO_ENCRYPTION_KEY,
  emailLookupSecret: environment.EMAIL_LOOKUP_SECRET,
  isProduction: environment.NODE_ENV === 'production',
});
