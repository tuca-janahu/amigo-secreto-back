import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import { prisma } from '../../lib/prisma.js';
import type { Credentials } from './auth.schemas.js';
import type { PublicUser } from './auth.types.js';

const BCRYPT_SALT_ROUNDS = 12;

const publicUserSelect = {
  id: true,
  email: true,
} satisfies Prisma.UserSelect;

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export const registerUser = async ({
  email,
  password,
}: Credentials): Promise<PublicUser> => {
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    throw new AppError(409, 'Email already registered.');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  try {
    return await prisma.user.create({
      data: { email, passwordHash },
      select: publicUserSelect,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError(409, 'Email already registered.');
    }

    throw error;
  }
};

export const authenticateUser = async ({
  email,
  password,
}: Credentials): Promise<PublicUser> => {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      ...publicUserSelect,
      passwordHash: true,
    },
  });

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError(401, 'Invalid credentials.');
  }

  return { id: user.id, email: user.email };
};

export const getUserById = async (userId: string): Promise<PublicUser | null> =>
  prisma.user.findUnique({
    where: { id: userId },
    select: publicUserSelect,
  });
