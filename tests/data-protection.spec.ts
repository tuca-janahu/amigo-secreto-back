import { describe, expect, it } from 'vitest';

import {
  createEmailLookupHash,
  decryptData,
  encryptData,
} from '../src/lib/data-protection.js';

describe('data protection', () => {
  it('encrypts and decrypts values with AES-256-GCM', () => {
    const encrypted = encryptData('Lucas Silva');

    expect(encrypted).not.toContain('Lucas Silva');
    expect(decryptData(encrypted)).toBe('Lucas Silva');
  });

  it('uses a distinct ciphertext for the same plaintext', () => {
    expect(encryptData('lucas@email.com')).not.toBe(
      encryptData('lucas@email.com'),
    );
  });

  it('rejects modified ciphertexts', () => {
    const encrypted = encryptData('Lucas Silva');
    const replacement = encrypted.endsWith('A') ? 'B' : 'A';
    const modified = `${encrypted.slice(0, -1)}${replacement}`;

    expect(() => decryptData(modified)).toThrow(
      'Unable to decrypt protected data.',
    );
  });

  it('creates deterministic HMAC lookups for normalized equivalent emails', () => {
    const firstHash = createEmailLookupHash('  Lucas@Email.com ');
    const secondHash = createEmailLookupHash('lucas@email.com');

    expect(firstHash).toBe(secondHash);
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
