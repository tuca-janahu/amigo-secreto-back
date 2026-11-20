import { AuditEventType, type Prisma } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';

type AuditEventInput = {
  type: AuditEventType;
  actorUserId: string;
  actorName?: string;
  groupId?: string;
  groupName?: string;
  occurredAt?: Date;
};

// The caller must use the transaction that performs the business operation.
export const recordAuditEvent = async (
  transaction: Prisma.TransactionClient,
  input: AuditEventInput,
): Promise<void> => {
  const actorName =
    input.actorName ??
    (
      await transaction.user.findUnique({
        where: { id: input.actorUserId },
        select: { name: true },
      })
    )?.name;

  if (actorName === undefined) {
    throw new AppError(401, 'Não autorizado.');
  }

  await transaction.auditEvent.create({
    data: { ...input, actorName },
    select: { id: true },
  });
};
