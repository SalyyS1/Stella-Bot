-- CreateTable
CREATE TABLE "ReminderAlias" (
    "alias" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderAlias_pkey" PRIMARY KEY ("alias")
);

-- CreateIndex
CREATE INDEX "ReminderAlias_userId_idx" ON "ReminderAlias"("userId");
