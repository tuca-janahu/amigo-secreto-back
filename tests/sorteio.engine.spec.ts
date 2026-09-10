import { describe, expect, it } from 'vitest';

import {
  findSorteioMatching,
  type SorteioRestriction,
} from '../src/modules/sorteio/sorteio.engine.js';

const expectValidMatching = (
  participantIds: string[],
  restrictions: SorteioRestriction[] = [],
): void => {
  const matching = findSorteioMatching(participantIds, restrictions);

  expect(matching).not.toBeNull();

  if (!matching) {
    return;
  }

  expect(matching.size).toBe(participantIds.length);
  const receivers = [...matching.values()];
  expect(new Set(receivers).size).toBe(participantIds.length);

  for (const participantId of participantIds) {
    const receiverParticipantId = matching.get(participantId);
    expect(receiverParticipantId).toBeDefined();
    expect(receiverParticipantId).not.toBe(participantId);
    expect(
      restrictions.some(
        (restriction) =>
          restriction.giverParticipantId === participantId &&
          restriction.forbiddenParticipantId === receiverParticipantId,
      ),
    ).toBe(false);
  }
};

describe('sorteio engine', () => {
  it('finds a valid matching for three participants without restrictions', () => {
    expectValidMatching(['a', 'b', 'c']);
  });

  it('finds a valid matching for five participants without restrictions', () => {
    expectValidMatching(['a', 'b', 'c', 'd', 'e']);
  });

  it('respects a directional restriction', () => {
    const restrictions = [
      { giverParticipantId: 'a', forbiddenParticipantId: 'b' },
    ];

    expectValidMatching(['a', 'b', 'c'], restrictions);
  });

  it('respects multiple restrictions', () => {
    const restrictions = [
      { giverParticipantId: 'a', forbiddenParticipantId: 'b' },
      { giverParticipantId: 'a', forbiddenParticipantId: 'c' },
      { giverParticipantId: 'b', forbiddenParticipantId: 'd' },
      { giverParticipantId: 'c', forbiddenParticipantId: 'a' },
      { giverParticipantId: 'd', forbiddenParticipantId: 'e' },
      { giverParticipantId: 'e', forbiddenParticipantId: 'b' },
    ];

    expectValidMatching(['a', 'b', 'c', 'd', 'e'], restrictions);
  });

  it('recognizes an impossible set of restrictions', () => {
    const matching = findSorteioMatching(['a', 'b', 'c'], [
      { giverParticipantId: 'a', forbiddenParticipantId: 'b' },
      { giverParticipantId: 'a', forbiddenParticipantId: 'c' },
    ]);

    expect(matching).toBeNull();
  });

  it('keeps matching invariants across randomized executions', () => {
    for (let index = 0; index < 10; index += 1) {
      expectValidMatching(['a', 'b', 'c', 'd']);
    }
  });
});
