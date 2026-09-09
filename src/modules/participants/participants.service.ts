import { GroupStatus, Prisma } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import {
  createEmailLookupHash,
  decryptData,
  encryptData,
  normalizeEmail,
} from '../../lib/data-protection.js';
import { prisma } from '../../lib/prisma.js';
import type {
  CreateParticipantInput,
  UpdateParticipantInput,
} from './participants.schemas.js';
import {
  importValidationMessage,
  parseParticipantImport,
} from './participants.import.js';

const ownedGroupSelect = {
  id: true,
  status: true,
} satisfies Prisma.GroupSelect;

const protectedParticipantSelect = {
  id: true,
  nameEncrypted: true,
  emailEncrypted: true,
  emailLookupHash: true,
  createdAt: true,
} satisfies Prisma.ParticipantSelect;

type ProtectedParticipant = Prisma.ParticipantGetPayload<{
  select: typeof protectedParticipantSelect;
}>;

type ParticipantIdentity = {
  name: string;
  email: string;
  emailLookupHash: string;
};

const getOwnedGroup = async (groupId: string, ownerId: string) => {
  const group = await prisma.group.findFirst({
    where: { id: groupId, ownerId },
    select: ownedGroupSelect,
  });

  if (!group) {
    throw new AppError(404, 'Group not found.');
  }

  return group;
};

const ensureDraft = (status: GroupStatus): void => {
  if (status !== GroupStatus.DRAFT) {
    throw new AppError(409, 'Group can only be changed while in DRAFT.');
  }
};

const getGroupParticipant = async (groupId: string, participantId: string) => {
  const participant = await prisma.participant.findFirst({
    where: { id: participantId, groupId },
    select: protectedParticipantSelect,
  });

  if (!participant) {
    throw new AppError(404, 'Participant not found.');
  }

  return participant;
};

const toPublicParticipant = (participant: ProtectedParticipant) => ({
  id: participant.id,
  name: decryptData(participant.nameEncrypted),
  email: decryptData(participant.emailEncrypted),
  createdAt: participant.createdAt,
});

const emailAlreadyExists = async (groupId: string, emailLookupHash: string) =>
  prisma.participant.findFirst({
    where: { groupId, emailLookupHash },
    select: { id: true },
  });

const toParticipantIdentity = ({ name, email }: CreateParticipantInput): ParticipantIdentity => {
  const normalizedEmail = normalizeEmail(email);

  return {
    name,
    email: normalizedEmail,
    emailLookupHash: createEmailLookupHash(normalizedEmail),
  };
};

const toProtectedParticipantData = (
  groupId: string,
  participant: ParticipantIdentity,
) => ({
  groupId,
  nameEncrypted: encryptData(participant.name),
  emailEncrypted: encryptData(participant.email),
  emailLookupHash: participant.emailLookupHash,
});

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export const createParticipant = async (
  groupId: string,
  ownerId: string,
  { name, email }: CreateParticipantInput,
) => {
  const group = await getOwnedGroup(groupId, ownerId);
  ensureDraft(group.status);

  const participantIdentity = toParticipantIdentity({ name, email });

  if (await emailAlreadyExists(group.id, participantIdentity.emailLookupHash)) {
    throw new AppError(409, 'Email already exists in this group.');
  }

  try {
    const participant = await prisma.participant.create({
      data: {
        ...toProtectedParticipantData(group.id, participantIdentity),
      },
      select: protectedParticipantSelect,
    });

    return toPublicParticipant(participant);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError(409, 'Email already exists in this group.');
    }

    throw error;
  }
};

export const importParticipants = async (
  groupId: string,
  ownerId: string,
  data: string,
) => {
  const group = await getOwnedGroup(groupId, ownerId);
  ensureDraft(group.status);

  const parsedImport = parseParticipantImport(data);

  if (parsedImport.issues.length > 0) {
    throw new AppError(400, importValidationMessage(parsedImport.issues));
  }

  const participantIdentities = parsedImport.participants.map(toParticipantIdentity);
  const firstLineByHash = new Map<string, number>();
  const duplicateIssues = [] as Array<{ line: number; reason: string }>;

  for (const [index, participant] of participantIdentities.entries()) {
    const originalLine = firstLineByHash.get(participant.emailLookupHash);

    if (originalLine !== undefined) {
      duplicateIssues.push({
        line: parsedImport.participants[index].line,
        reason: `Duplicate email also provided on line ${originalLine}.`,
      });
      continue;
    }

    firstLineByHash.set(participant.emailLookupHash, parsedImport.participants[index].line);
  }

  if (duplicateIssues.length > 0) {
    throw new AppError(400, importValidationMessage(duplicateIssues));
  }

  const existingParticipants = await prisma.participant.findMany({
    where: {
      groupId: group.id,
      emailLookupHash: {
        in: participantIdentities.map(({ emailLookupHash }) => emailLookupHash),
      },
    },
    select: { id: true },
  });

  if (existingParticipants.length > 0) {
    throw new AppError(409, 'Email already exists in this group.');
  }

  try {
    const createdParticipants = await prisma.$transaction((transaction) =>
      Promise.all(
        participantIdentities.map((participantIdentity) =>
          transaction.participant.create({
            data: toProtectedParticipantData(group.id, participantIdentity),
            select: protectedParticipantSelect,
          }),
        ),
      ),
    );

    return createdParticipants.map(toPublicParticipant);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError(409, 'Email already exists in this group.');
    }

    throw error;
  }
};

export const listParticipants = async (groupId: string, ownerId: string) => {
  const group = await getOwnedGroup(groupId, ownerId);
  const participants = await prisma.participant.findMany({
    where: { groupId: group.id },
    orderBy: { createdAt: 'asc' },
    select: protectedParticipantSelect,
  });

  return participants.map(toPublicParticipant);
};

export const getParticipant = async (
  groupId: string,
  participantId: string,
  ownerId: string,
) => {
  const group = await getOwnedGroup(groupId, ownerId);
  const participant = await getGroupParticipant(group.id, participantId);

  return toPublicParticipant(participant);
};

export const updateParticipant = async (
  groupId: string,
  participantId: string,
  ownerId: string,
  input: UpdateParticipantInput,
) => {
  const group = await getOwnedGroup(groupId, ownerId);
  ensureDraft(group.status);
  const participant = await getGroupParticipant(group.id, participantId);
  const data: Prisma.ParticipantUpdateInput = {};

  if (input.name !== undefined) {
    data.nameEncrypted = encryptData(input.name);
  }

  if (input.email !== undefined) {
    const normalizedEmail = normalizeEmail(input.email);
    const emailLookupHash = createEmailLookupHash(normalizedEmail);

    if (emailLookupHash !== participant.emailLookupHash) {
      if (await emailAlreadyExists(group.id, emailLookupHash)) {
        throw new AppError(409, 'Email already exists in this group.');
      }
    }

    data.emailEncrypted = encryptData(normalizedEmail);
    data.emailLookupHash = emailLookupHash;
  }

  try {
    const updatedParticipant = await prisma.participant.update({
      where: { id: participant.id },
      data,
      select: protectedParticipantSelect,
    });

    return toPublicParticipant(updatedParticipant);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError(409, 'Email already exists in this group.');
    }

    throw error;
  }
};

export const deleteParticipant = async (
  groupId: string,
  participantId: string,
  ownerId: string,
): Promise<void> => {
  const group = await getOwnedGroup(groupId, ownerId);
  ensureDraft(group.status);
  const participant = await getGroupParticipant(group.id, participantId);

  await prisma.participant.delete({ where: { id: participant.id } });
};
