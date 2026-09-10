import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      PORT: '3333',
      DATABASE_URL:
        'postgresql://postgres:postgres@localhost:5432/amigo_secreto_test?schema=public',
      FRONTEND_URL: 'http://localhost:5173',
      RESEND_API_KEY: 'test-resend-api-key',
      EMAIL_FROM: 'Amigo Secreto <noreply@example.com>',
      APP_URL: 'http://localhost:5173',
      JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
      DATA_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=', // CHAVE FAKE PARA TESTES
      SORTEIO_ENCRYPTION_KEY: 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU=', // CHAVE FAKE PARA TESTES
      EMAIL_LOOKUP_SECRET: 'test-email-lookup-secret-with-32-characters',
    },
  },
});
