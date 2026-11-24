import { createHash, randomBytes } from 'node:crypto';

export const generateGroupInvitationToken = (): string =>
  randomBytes(32).toString('base64url');

export const hashGroupInvitationToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');
