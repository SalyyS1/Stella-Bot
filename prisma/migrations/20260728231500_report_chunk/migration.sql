-- CreateTable
CREATE TABLE "ReportChunk" (
    "id" SERIAL NOT NULL,
    "period" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "msgCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportChunk_period_slot_key" ON "ReportChunk"("period", "slot");

-- CreateIndex
CREATE INDEX "ReportChunk_period_idx" ON "ReportChunk"("period");
