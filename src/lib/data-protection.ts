import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

import { config } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const FORMAT_VERSION = 'v1';
const IV_LENGTH = 12;
const BASE64_URL_PART = /^[A-Za-z0-9_-]+$/;

const protectedDataError = (): Error =>
  new Error('Unable to decrypt protected data.');

// Criptografa o nome da pessoa que foi sorteada para armazenar um valor protegido no banco.
export const encryptData = (plaintext: string): string => {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, config.dataEncryptionKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    FORMAT_VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
};

// Descriptografa o nome da pessoa que foi sorteada, retornando o nome original.
export const decryptData = (protectedValue: string): string => {
  try {
    const [version, ivPart, authTagPart, ciphertextPart, ...remainingParts] =
      protectedValue.split(':');

    if (
      version !== FORMAT_VERSION ||
      remainingParts.length > 0 ||
      !ivPart ||
      !authTagPart ||
      !ciphertextPart ||
      !BASE64_URL_PART.test(ivPart) ||
      !BASE64_URL_PART.test(authTagPart) ||
      !BASE64_URL_PART.test(ciphertextPart)
    ) {
      throw protectedDataError();
    }

    const iv = Buffer.from(ivPart, 'base64url');
    const authTag = Buffer.from(authTagPart, 'base64url');
    const ciphertext = Buffer.from(ciphertextPart, 'base64url');

    if (iv.length !== IV_LENGTH || authTag.length !== 16 || ciphertext.length === 0) {
      throw protectedDataError();
    }

    const decipher = createDecipheriv(ALGORITHM, config.dataEncryptionKey, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    throw protectedDataError();
  }
};

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const createEmailLookupHash = (email: string): string =>
  createHmac('sha256', config.emailLookupSecret)
    .update(normalizeEmail(email), 'utf8')
    .digest('hex');
