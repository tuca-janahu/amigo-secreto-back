import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import { prisma } from '../../lib/prisma.js';
import type {
  Credentials,
  ForgotPasswordInput,
  RegistrationInput,
  ResetPasswordInput,
} from './auth.schemas.js';
import type { PublicUser } from './auth.types.js';
import { sendPasswordResetEmail } from './password-reset-email.service.js';
import {
  generatePasswordResetToken,
  getPasswordResetExpiration,
  hashPasswordResetToken,
} from './password-reset.tokens.js';

const BCRYPT_SALT_ROUNDS = 12;

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
} satisfies Prisma.UserSelect;

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export const registerUser = async ({
  name,
  email,
  password,
}: RegistrationInput): Promise<PublicUser> => {
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    throw new AppError(409, 'E-mail já cadastrado.');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  try {
    return await prisma.user.create({
      data: { name, email, passwordHash },
      select: publicUserSelect,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError(409, 'E-mail já cadastrado.');
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
    throw new AppError(401, 'Credenciais inválidas.');
  }

  return { id: user.id, name: user.name, email: user.email };
};

export const getUserById = async (userId: string): Promise<PublicUser | null> =>
  prisma.user.findUnique({
    where: { id: userId },
    select: publicUserSelect,
  });

export const requestPasswordReset = async ({
  email,
}: ForgotPasswordInput): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });

  if (!user) {
    return;
  }

  const token = generatePasswordResetToken();
  const tokenHash = hashPasswordResetToken(token);

  await prisma.$transaction(async (transaction) => {
    await transaction.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });
    await transaction.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: getPasswordResetExpiration(),
      },
    });
  });

  try {
    await sendPasswordResetEmail({ recipient: user.email, token });
  } catch {
    await prisma.passwordResetToken.deleteMany({ where: { tokenHash } });
  }
};

const invalidPasswordResetError = (): AppError =>
  new AppError(400, 'Link de redefinição inválido ou expirado.');

export const resetPassword = async ({
  token,
  password,
}: ResetPasswordInput): Promise<void> => {
  const tokenHash = hashPasswordResetToken(token);
  const passwordResetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true },
  });

  if (!passwordResetToken || passwordResetToken.expiresAt.getTime() <= Date.now()) {
    throw invalidPasswordResetError();
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  const now = new Date();

  await prisma.$transaction(async (transaction) => {
    const consumed = await transaction.passwordResetToken.deleteMany({
      where: {
        id: passwordResetToken.id,
        expiresAt: { gt: now },
      },
    });

    if (consumed.count !== 1) {
      throw invalidPasswordResetError();
    }

    await transaction.user.update({
      where: { id: passwordResetToken.userId },
      data: { passwordHash },
    });
    await transaction.passwordResetToken.deleteMany({
      where: { userId: passwordResetToken.userId },
    });
  });
};
