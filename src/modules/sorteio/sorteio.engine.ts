import { randomInt } from 'node:crypto';

export type SorteioRestriction = {
  giverParticipantId: string;
  forbiddenParticipantId: string;
};

const shuffle = <Value>(values: readonly Value[]): Value[] => {
  const shuffled = [...values];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = randomInt(index + 1);
    [shuffled[index], shuffled[randomIndex]] = [
      shuffled[randomIndex],
      shuffled[index],
    ];
  }

  return shuffled;
};

export const findSorteioMatching = (
  participantIds: readonly string[],
  restrictions: readonly SorteioRestriction[],
): Map<string, string> | null => {
  const forbiddenReceiversByGiver = new Map<string, Set<string>>();

  for (const restriction of restrictions) {
    const forbiddenReceivers = forbiddenReceiversByGiver.get(
      restriction.giverParticipantId,
    ) ?? new Set<string>();
    forbiddenReceivers.add(restriction.forbiddenParticipantId);
    forbiddenReceiversByGiver.set(restriction.giverParticipantId, forbiddenReceivers);
  }

  const candidatesByGiver = new Map(
    participantIds.map((giverParticipantId) => [
      giverParticipantId,
      shuffle(
        participantIds.filter(
          (receiverParticipantId) =>
            receiverParticipantId !== giverParticipantId &&
            !forbiddenReceiversByGiver
              .get(giverParticipantId)
              ?.has(receiverParticipantId),
        ),
      ),
    ]),
  );
  const giverByReceiver = new Map<string, string>();

  const assignReceiver = (
    giverParticipantId: string,
    seenReceivers: Set<string>,
  ): boolean => {
    const candidates = candidatesByGiver.get(giverParticipantId) ?? [];

    for (const receiverParticipantId of candidates) {
      if (seenReceivers.has(receiverParticipantId)) {
        continue;
      }

      seenReceivers.add(receiverParticipantId);
      const currentGiver = giverByReceiver.get(receiverParticipantId);

      if (
        currentGiver === undefined ||
        assignReceiver(currentGiver, seenReceivers)
      ) {
        giverByReceiver.set(receiverParticipantId, giverParticipantId);
        return true;
      }
    }

    return false;
  };

  for (const giverParticipantId of shuffle(participantIds)) {
    if (!assignReceiver(giverParticipantId, new Set<string>())) {
      return null;
    }
  }

  const receiverByGiver = new Map<string, string>();

  for (const [receiverParticipantId, giverParticipantId] of giverByReceiver) {
    receiverByGiver.set(giverParticipantId, receiverParticipantId);
  }

  return receiverByGiver;
};
