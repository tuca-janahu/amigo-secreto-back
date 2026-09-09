import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      PORT: '3333',
      DATABASE_URL:
        'postgresql://postgres:postgres@localhost:5432/amigo_secreto_test?schema=public',
      FRONTEND_URL: 'http://localhost:5173',
      JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
      DATA_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=', // CHAVE FAKE PARA TESTES
      EMAIL_LOOKUP_SECRET: 'test-email-lookup-secret-with-32-characters',
    },
  },
});
