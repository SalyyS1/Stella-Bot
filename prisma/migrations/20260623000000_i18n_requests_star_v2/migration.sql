ALTER TABLE "Giveaway" ADD COLUMN IF NOT EXISTS "pingRoleId" TEXT;

CREATE TABLE IF NOT EXISTS "GuildSettings" (
    "guildId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'vi',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GuildSettings_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE IF NOT EXISTS "StarItemStack" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StarItemStack_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RequestPost" (
    "id" SERIAL NOT NULL,
    "messageId" TEXT,
    "channelId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "budget" TEXT,
    "other" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "claimedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RequestPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RequestClaim" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "claimerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RequestClaim_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RequestReview" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RequestReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StarItemStack_userId_key_key" ON "StarItemStack"("userId", "key");
CREATE INDEX IF NOT EXISTS "StarItemStack_userId_idx" ON "StarItemStack"("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "RequestPost_messageId_key" ON "RequestPost"("messageId");
CREATE INDEX IF NOT EXISTS "RequestPost_requesterId_idx" ON "RequestPost"("requesterId");
CREATE INDEX IF NOT EXISTS "RequestPost_status_idx" ON "RequestPost"("status");
CREATE INDEX IF NOT EXISTS "RequestPost_kind_idx" ON "RequestPost"("kind");

CREATE UNIQUE INDEX IF NOT EXISTS "RequestClaim_requestId_claimerId_key" ON "RequestClaim"("requestId", "claimerId");
CREATE INDEX IF NOT EXISTS "RequestClaim_claimerId_idx" ON "RequestClaim"("claimerId");
CREATE INDEX IF NOT EXISTS "RequestClaim_status_idx" ON "RequestClaim"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "RequestReview_requestId_reviewerId_key" ON "RequestReview"("requestId", "reviewerId");
CREATE INDEX IF NOT EXISTS "RequestReview_targetId_idx" ON "RequestReview"("targetId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StarItemStack_userId_fkey') THEN
        ALTER TABLE "StarItemStack" ADD CONSTRAINT "StarItemStack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RequestClaim_requestId_fkey') THEN
        ALTER TABLE "RequestClaim" ADD CONSTRAINT "RequestClaim_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RequestPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RequestClaim_claimerId_fkey') THEN
        ALTER TABLE "RequestClaim" ADD CONSTRAINT "RequestClaim_claimerId_fkey" FOREIGN KEY ("claimerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RequestReview_requestId_fkey') THEN
        ALTER TABLE "RequestReview" ADD CONSTRAINT "RequestReview_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RequestPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RequestReview_reviewerId_fkey') THEN
        ALTER TABLE "RequestReview" ADD CONSTRAINT "RequestReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RequestReview_targetId_fkey') THEN
        ALTER TABLE "RequestReview" ADD CONSTRAINT "RequestReview_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
