import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Normalização dos dados da .env para os tipos corretos e validação de valores obrigatórios
const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).optional(),
  DATABASE_URL: z
    .string()
    .url('DATABASE_URL deve ser uma URL de conexão válida.'),
  FRONTEND_URL: z.string().url('FRONTEND_URL deve ser uma URL válida.'),
  RESEND_API_KEY: z
    .string()
    .min(10, 'RESEND_API_KEY deve ter ao menos 10 caracteres.'),
  EMAIL_FROM: z.string().min(1, 'EMAIL_FROM deve ser informado.'),
  APP_URL: z.string().url('APP_URL deve ser uma URL válida.'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter ao menos 32 caracteres.'),
  DATA_ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[A-Za-z0-9+/]{43}=$/,
      'DATA_ENCRYPTION_KEY deve ser uma chave AES-256 de 32 bytes em Base64.',
    )
    .transform((value) => Buffer.from(value, 'base64'))
    .refine(
      (value) => value.length === 32,
      'DATA_ENCRYPTION_KEY deve corresponder a exatamente 32 bytes.',
    ),
  SORTEIO_ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[A-Za-z0-9+/]{43}=$/,
      'SORTEIO_ENCRYPTION_KEY deve ser uma chave AES-256 de 32 bytes em Base64.',
    )
    .transform((value) => Buffer.from(value, 'base64'))
    .refine(
      (value) => value.length === 32,
      'SORTEIO_ENCRYPTION_KEY deve corresponder a exatamente 32 bytes.',
    ),
  EMAIL_LOOKUP_SECRET: z
    .string()
    .min(32, 'EMAIL_LOOKUP_SECRET deve ter ao menos 32 caracteres.'),
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
  trustProxyHops:
    environment.TRUST_PROXY_HOPS ??
    (environment.NODE_ENV === 'production' ? 1 : 0),
  databaseUrl: environment.DATABASE_URL,
  frontendOrigin: new URL(environment.FRONTEND_URL).origin,
  resendApiKey: environment.RESEND_API_KEY,
  emailFrom: environment.EMAIL_FROM,
  appUrl: environment.APP_URL,
  jwtSecret: environment.JWT_SECRET,
  dataEncryptionKey: environment.DATA_ENCRYPTION_KEY,
  sorteioEncryptionKey: environment.SORTEIO_ENCRYPTION_KEY,
  emailLookupSecret: environment.EMAIL_LOOKUP_SECRET,
  isProduction: environment.NODE_ENV === 'production',
});
