import { createHash, randomBytes } from 'node:crypto';

export const PASSWORD_RESET_TOKEN_BYTES = 32;
export const PASSWORD_RESET_EXPIRATION_MS = 60 * 60 * 1000;

export const generatePasswordResetToken = (): string =>
  randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString('base64url');

export const hashPasswordResetToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export const getPasswordResetExpiration = (now: Date = new Date()): Date =>
  new Date(now.getTime() + PASSWORD_RESET_EXPIRATION_MS);
