import bcrypt from 'bcrypt';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: {
    create: vi.fn(),
    findUnique: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));

import { app } from '../src/app.js';

type StoredUser = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
};

const users = new Map<string, StoredUser>();

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
  users.clear();
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
      expect(invalidPassword.body).toEqual({ message: 'Invalid credentials.' });
      expect(unknownUser.body).toEqual({ message: 'Invalid credentials.' });
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
});
