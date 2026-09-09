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
    },
  },
});
