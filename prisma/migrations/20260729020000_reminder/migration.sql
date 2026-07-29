-- CreateTable
CREATE TABLE "Reminder" (
    "id" SERIAL NOT NULL,
    "requesterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "nextFireAt" TIMESTAMP(3) NOT NULL,
    "repeatDaily" BOOLEAN NOT NULL DEFAULT false,
    "hourVn" INTEGER NOT NULL,
    "minuteVn" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastFiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reminder_active_nextFireAt_idx" ON "Reminder"("active", "nextFireAt");

-- CreateIndex
CREATE INDEX "Reminder_targetId_idx" ON "Reminder"("targetId");
