-- CreateTable
CREATE TABLE "ReportDaily" (
    "id" SERIAL NOT NULL,
    "period" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportDaily_period_key" ON "ReportDaily"("period");
