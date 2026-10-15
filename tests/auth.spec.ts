import bcrypt from 'bcrypt';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  user: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  passwordResetToken: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findUnique: vi.fn(),
  },
}));

const sendPasswordResetEmailMock = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/modules/auth/password-reset-email.service.js', () => ({
  sendPasswordResetEmail: sendPasswordResetEmailMock,
}));

import { app } from '../src/app.js';
import { authRateLimiter } from '../src/middlewares/security.js';

type StoredUser = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
};

const users = new Map<string, StoredUser>();

type StoredPasswordResetToken = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
};

const passwordResetTokens = new Map<string, StoredPasswordResetToken>();

const addUser = async (
  email: string,
  password: string,
  name = 'Existing User',
): Promise<StoredUser> => {
  const user = {
    id: `user-${users.size + 1}`,
    name,
    email,
    passwordHash: await bcrypt.hash(password, 4),
  };

  users.set(user.email, user);
  return user;
};

const getAuthCookie = (setCookie: string[] | undefined): string => {
  const authCookie = setCookie?.find((cookie) =>
    cookie.startsWith('auth_token='),
  );

  if (!authCookie) {
    throw new Error('Authentication cookie was not set.');
  }

  return authCookie.split(';')[0];
};

beforeEach(() => {
  vi.clearAllMocks();
  authRateLimiter.resetKey('127.0.0.1');
  users.clear();
  passwordResetTokens.clear();
  sendPasswordResetEmailMock.mockResolvedValue(undefined);
  prismaMock.$transaction.mockImplementation(async (callback) =>
    callback(prismaMock),
  );
  prismaMock.user.findUnique.mockImplementation(async ({ where, select }) => {
    const user = where.email
      ? users.get(where.email)
      : [...users.values()].find((storedUser) => storedUser.id === where.id);

    if (!user) {
      return null;
    }

    if (select.passwordHash) {
      return user;
    }

    return { id: user.id, name: user.name, email: user.email };
  });
  prismaMock.user.create.mockImplementation(async ({ data }) => {
    const user = {
      id: `user-${users.size + 1}`,
      name: data.name,
      email: data.email,
      passwordHash: data.passwordHash,
    };

    users.set(user.email, user);
    return { id: user.id, name: user.name, email: user.email };
  });
  prismaMock.user.update.mockImplementation(async ({ where, data }) => {
    const user = [...users.values()].find(({ id }) => id === where.id);

    if (!user) {
      throw new Error('User not found.');
    }

    Object.assign(user, data);
    return user;
  });
  prismaMock.passwordResetToken.create.mockImplementation(async ({ data }) => {
    const token = {
      id: `password-reset-${passwordResetTokens.size + 1}`,
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      createdAt: new Date(),
    };

    passwordResetTokens.set(token.tokenHash, token);
    return token;
  });
  prismaMock.passwordResetToken.findUnique.mockImplementation(
    async ({ where }) => passwordResetTokens.get(where.tokenHash) ?? null,
  );
  prismaMock.passwordResetToken.deleteMany.mockImplementation(
    async ({ where }) => {
      const matchingTokens = [...passwordResetTokens.values()].filter(
        (token) => {
          if (where.userId && token.userId !== where.userId) return false;
          if (where.tokenHash && token.tokenHash !== where.tokenHash) return false;
          if (where.id && token.id !== where.id) return false;
          if (where.expiresAt?.gt && token.expiresAt <= where.expiresAt.gt) {
            return false;
          }
          return true;
        },
      );

      for (const token of matchingTokens) {
        passwordResetTokens.delete(token.tokenHash);
      }

      return { count: matchingTokens.length };
    },
  );
});

describe('auth', () => {
  describe('POST /auth/register', () => {
    it('creates a user with normalized email and does not expose passwordHash', async () => {
      const response = await request(app).post('/auth/register').send({
        name: '  Artur  ',
        email: '  User@Email.com  ',
        password: 'secure-password',
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        user: { id: 'user-1', name: 'Artur', email: 'user@email.com' },
      });
      expect(response.body.user.passwordHash).toBeUndefined();

      const storedUser = users.get('user@email.com');
      expect(storedUser?.passwordHash).not.toBe('secure-password');
      await expect(
        bcrypt.compare('secure-password', storedUser?.passwordHash ?? ''),
      ).resolves.toBe(true);
    });

    it('rejects an invalid email', async () => {
      const response = await request(app).post('/auth/register').send({
        name: 'Artur',
        email: 'invalid-email',
        password: 'secure-password',
      });

      expect(response.status).toBe(400);
    });

    it('rejects a password shorter than eight characters', async () => {
      const response = await request(app).post('/auth/register').send({
        name: 'Artur',
        email: 'user@email.com',
        password: 'short',
      });

      expect(response.status).toBe(400);
    });

    it('rejects an empty name', async () => {
      const response = await request(app).post('/auth/register').send({
        name: '   ',
        email: 'user@email.com',
        password: 'secure-password',
      });

      expect(response.status).toBe(400);
    });

    it('rejects a duplicate email', async () => {
      await addUser('user@email.com', 'secure-password');

      const response = await request(app).post('/auth/register').send({
        name: 'Artur',
        email: 'user@email.com',
        password: 'another-password',
      });

      expect(response.status).toBe(409);
    });
  });

  describe('POST /auth/login', () => {
    it('authenticates valid credentials and configures an HTTP-only cookie', async () => {
      await addUser('user@email.com', 'secure-password', 'Artur');

      const response = await request(app).post('/auth/login').send({
        email: 'USER@EMAIL.COM',
        password: 'secure-password',
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        user: { id: 'user-1', name: 'Artur', email: 'user@email.com' },
      });
      expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
      expect(response.headers['set-cookie']?.[0]).toContain('SameSite=Lax');
      expect(response.headers['set-cookie']?.[0]).toContain('Path=/');
      expect(response.headers['set-cookie']?.[0]).toContain('Max-Age=604800');
      expect(response.body).not.toHaveProperty('token');
    });

    it('returns the same generic error for invalid passwords and unknown users', async () => {
      await addUser('user@email.com', 'secure-password', 'Artur');

      const invalidPassword = await request(app).post('/auth/login').send({
        email: 'user@email.com',
        password: 'wrong-password',
      });
      const unknownUser = await request(app).post('/auth/login').send({
        email: 'unknown@email.com',
        password: 'wrong-password',
      });

      expect(invalidPassword.status).toBe(401);
      expect(unknownUser.status).toBe(401);
      expect(invalidPassword.body).toEqual({ message: 'Credenciais inválidas.' });
      expect(unknownUser.body).toEqual({ message: 'Credenciais inválidas.' });
    });

    it('aplica rate limit após dez tentativas por IP', async () => {
      const responses = [];

      for (let attempt = 0; attempt < 11; attempt += 1) {
        responses.push(
          await request(app).post('/auth/login').send({
            email: 'unknown@email.com',
            password: 'wrong-password',
          }),
        );
      }

      expect(responses.slice(0, 10).every(({ status }) => status === 401)).toBe(true);
      expect(responses[10].status).toBe(429);
      expect(responses[10].body).toEqual({
        message: 'Muitas tentativas. Tente novamente em alguns minutos.',
      });
    });
  });

  describe('GET /auth/me', () => {
    it('returns the authenticated user', async () => {
      await addUser('user@email.com', 'secure-password', 'Artur');
      const loginResponse = await request(app).post('/auth/login').send({
        email: 'user@email.com',
        password: 'secure-password',
      });

      const response = await request(app)
        .get('/auth/me')
        .set('Cookie', getAuthCookie(loginResponse.headers['set-cookie']));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        user: { id: 'user-1', name: 'Artur', email: 'user@email.com' },
      });
    });

    it('rejects requests without authentication', async () => {
      const response = await request(app).get('/auth/me');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('clears the authentication cookie', async () => {
      const response = await request(app).post('/auth/logout');

      expect(response.status).toBe(204);
      expect(response.headers['set-cookie']?.[0]).toContain('auth_token=;');
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('creates a one-hour hashed token and sends the original token by email', async () => {
      await addUser('user@email.com', 'secure-password', 'Artur');
      const beforeRequest = Date.now();

      const response = await request(app).post('/auth/forgot-password').send({
        email: '  USER@EMAIL.COM  ',
      });

      expect(response.status).toBe(202);
      expect(response.body).toEqual({
        message:
          'Se existir uma conta com este e-mail, enviaremos um link para redefinir a senha.',
      });
      expect(sendPasswordResetEmailMock).toHaveBeenCalledOnce();

      const { token } = sendPasswordResetEmailMock.mock.calls[0][0];
      const storedToken = [...passwordResetTokens.values()][0];
      expect(storedToken.tokenHash).not.toBe(token);
      expect(storedToken.expiresAt.getTime()).toBeGreaterThanOrEqual(
        beforeRequest + 60 * 60 * 1000,
      );
      expect(storedToken.expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + 60 * 60 * 1000,
      );
    });

    it('returns the same response for an unknown email without sending an email', async () => {
      const response = await request(app).post('/auth/forgot-password').send({
        email: 'unknown@email.com',
      });

      expect(response.status).toBe(202);
      expect(response.body).toEqual({
        message:
          'Se existir uma conta com este e-mail, enviaremos um link para redefinir a senha.',
      });
      expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
    });

    it('replaces an earlier token for the same user', async () => {
      await addUser('user@email.com', 'secure-password');

      await request(app)
        .post('/auth/forgot-password')
        .send({ email: 'user@email.com' });
      const firstTokenHash = [...passwordResetTokens.keys()][0];
      await request(app)
        .post('/auth/forgot-password')
        .send({ email: 'user@email.com' });

      expect(passwordResetTokens.size).toBe(1);
      expect(passwordResetTokens.has(firstTokenHash)).toBe(false);
    });

    it('keeps the generic response and removes the token when email sending fails', async () => {
      await addUser('user@email.com', 'secure-password');
      sendPasswordResetEmailMock.mockRejectedValueOnce(
        new Error('Provider unavailable'),
      );

      const response = await request(app).post('/auth/forgot-password').send({
        email: 'user@email.com',
      });

      expect(response.status).toBe(202);
      expect(passwordResetTokens.size).toBe(0);
    });
  });

  describe('POST /auth/reset-password', () => {
    it('changes the password and consumes the token only once', async () => {
      const user = await addUser('user@email.com', 'secure-password');
      await request(app)
        .post('/auth/forgot-password')
        .send({ email: user.email });
      const { token } = sendPasswordResetEmailMock.mock.calls[0][0];

      const response = await request(app).post('/auth/reset-password').send({
        token,
        password: 'new-secure-password',
      });
      const reusedTokenResponse = await request(app)
        .post('/auth/reset-password')
        .send({ token, password: 'another-secure-password' });

      expect(response.status).toBe(204);
      await expect(
        bcrypt.compare('new-secure-password', user.passwordHash),
      ).resolves.toBe(true);
      expect(passwordResetTokens.size).toBe(0);
      expect(reusedTokenResponse.status).toBe(400);
      expect(reusedTokenResponse.body).toEqual({
        message: 'Link de redefinição inválido ou expirado.',
      });
    });

    it('rejects expired and unknown tokens with the same error', async () => {
      await addUser('user@email.com', 'secure-password');
      await request(app)
        .post('/auth/forgot-password')
        .send({ email: 'user@email.com' });
      const { token } = sendPasswordResetEmailMock.mock.calls[0][0];
      const storedToken = [...passwordResetTokens.values()][0];
      storedToken.expiresAt = new Date(Date.now() - 1);

      const expiredResponse = await request(app)
        .post('/auth/reset-password')
        .send({ token, password: 'new-secure-password' });
      const unknownResponse = await request(app)
        .post('/auth/reset-password')
        .send({ token: 'unknown-token', password: 'new-secure-password' });

      expect(expiredResponse.status).toBe(400);
      expect(unknownResponse.status).toBe(400);
      expect(expiredResponse.body).toEqual(unknownResponse.body);
    });
  });
});
