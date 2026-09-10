import { createHash, randomBytes } from 'node:crypto';

export const PARTICIPANT_ACCESS_TOKEN_BYTES = 32;
export const PARTICIPANT_ACCESS_EXPIRATION_DAYS = 90;

const PARTICIPANT_ACCESS_EXPIRATION_MS =
  PARTICIPANT_ACCESS_EXPIRATION_DAYS * 24 * 60 * 60 * 1000;

export const generateParticipantAccessToken = (): string =>
  randomBytes(PARTICIPANT_ACCESS_TOKEN_BYTES).toString('base64url');

export const hashParticipantAccessToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export const getParticipantAccessExpiration = (now: Date = new Date()): Date =>
  new Date(now.getTime() + PARTICIPANT_ACCESS_EXPIRATION_MS);
