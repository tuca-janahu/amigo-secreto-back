-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('USER_REGISTERED', 'GROUP_CREATED', 'GROUP_RENAMED', 'SORTEIO_COMPLETED', 'GROUP_DELETED');

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "type" "AuditEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "groupId" TEXT,
    "groupName" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEvent_occurredAt_id_idx" ON "AuditEvent"("occurredAt", "id");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_occurredAt_id_idx" ON "AuditEvent"("actorUserId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "AuditEvent_groupId_occurredAt_id_idx" ON "AuditEvent"("groupId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "AuditEvent_type_occurredAt_id_idx" ON "AuditEvent"("type", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "Group_createdAt_idx" ON "Group"("createdAt");

-- CreateIndex
CREATE INDEX "Group_sorteadoAt_idx" ON "Group"("sorteadoAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
