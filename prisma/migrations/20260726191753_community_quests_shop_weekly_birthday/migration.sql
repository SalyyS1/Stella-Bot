-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastQuestDay" TEXT,
ADD COLUMN     "questStreak" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DailyQuest" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "questKey" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "reward" INTEGER NOT NULL,

    CONSTRAINT "DailyQuest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopColorRole" (
    "key" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopColorRole_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ShopPurchase" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyActivity" (
    "userId" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "xp" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WeeklyActivity_pkey" PRIMARY KEY ("userId","weekKey")
);

-- CreateTable
CREATE TABLE "WeeklyRewardRun" (
    "weekKey" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyRewardRun_pkey" PRIMARY KEY ("weekKey")
);

-- CreateTable
CREATE TABLE "Birthday" (
    "userId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "lastCelebratedYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Birthday_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "DailyQuest_userId_day_idx" ON "DailyQuest"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "DailyQuest_userId_day_questKey_key" ON "DailyQuest"("userId", "day", "questKey");

-- CreateIndex
CREATE INDEX "ShopPurchase_userId_idx" ON "ShopPurchase"("userId");

-- CreateIndex
CREATE INDEX "WeeklyActivity_weekKey_idx" ON "WeeklyActivity"("weekKey");

-- CreateIndex
CREATE INDEX "Birthday_month_day_idx" ON "Birthday"("month", "day");

-- AddForeignKey
ALTER TABLE "DailyQuest" ADD CONSTRAINT "DailyQuest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopPurchase" ADD CONSTRAINT "ShopPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyActivity" ADD CONSTRAINT "WeeklyActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Birthday" ADD CONSTRAINT "Birthday_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

