-- CreateTable
CREATE TABLE "GlossaryTerm" (
    "term" TEXT NOT NULL,
    "meaning" TEXT,
    "answeredBy" TEXT,
    "sourceMsg" TEXT,
    "askedAt" TIMESTAMP(3),
    "askCount" INTEGER NOT NULL DEFAULT 0,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlossaryTerm_pkey" PRIMARY KEY ("term")
);

-- CreateIndex
CREATE INDEX "GlossaryTerm_answeredAt_idx" ON "GlossaryTerm"("answeredAt");
