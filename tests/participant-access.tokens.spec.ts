import { describe, expect, it } from 'vitest';

import {
  PARTICIPANT_ACCESS_TOKEN_BYTES,
  generateParticipantAccessToken,
  hashParticipantAccessToken,
} from '../src/modules/participant-access/participant-access.tokens.js';

describe('participant access tokens', () => {
  it('generates distinct cryptographically-sized base64url tokens', () => {
    const firstToken = generateParticipantAccessToken();
    const secondToken = generateParticipantAccessToken();

    expect(firstToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(firstToken, 'base64url')).toHaveLength(
      PARTICIPANT_ACCESS_TOKEN_BYTES,
    );
    expect(secondToken).not.toBe(firstToken);
  });

  it('hashes the same token deterministically', () => {
    const token = generateParticipantAccessToken();

    expect(hashParticipantAccessToken(token)).toBe(hashParticipantAccessToken(token));
    expect(hashParticipantAccessToken(token)).toMatch(/^[a-f0-9]{64}$/);
  });
});
