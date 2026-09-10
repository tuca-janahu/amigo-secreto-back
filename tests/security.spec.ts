import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));

import { app } from '../src/app.js';
import { createAuthToken } from '../src/lib/auth-token.js';
import { authRateLimiter } from '../src/middlewares/security.js';

beforeEach(() => {
  vi.clearAllMocks();
  authRateLimiter.resetKey('127.0.0.1');
});

describe('hardening HTTP', () => {
  it('aplica headers de segurança sem alterar o health check', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('permite somente a origem configurada no CORS', async () => {
    const allowed = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:5173');
    const denied = await request(app)
      .get('/health')
      .set('Origin', 'https://site-malicioso.example');

    expect(allowed.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejeita corpo JSON acima de 100 kb', async () => {
    const response = await request(app)
      .post('/auth/login')
      .send({ data: 'a'.repeat(101 * 1024) });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      message: 'Corpo da requisição excede o limite permitido.',
    });
  });

  it('bloqueia origem não autorizada em operação autenticada mutável', async () => {
    const response = await request(app)
      .post('/groups')
      .set('Cookie', `auth_token=${createAuthToken('owner-1')}`)
      .set('Origin', 'https://site-malicioso.example')
      .send({ name: 'Grupo' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Origem não permitida.' });
  });

  it('não expõe detalhes de erros internos', async () => {
    prismaMock.user.findUnique.mockRejectedValueOnce(
      new Error('segredo interno em C:\\aplicacao\\arquivo.ts'),
    );

    const response = await request(app).post('/auth/login').send({
      email: 'user@email.com',
      password: 'secure-password',
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Erro interno do servidor.' });
    expect(JSON.stringify(response.body)).not.toContain('segredo interno');
    expect(JSON.stringify(response.body)).not.toContain('arquivo.ts');
  });
});
