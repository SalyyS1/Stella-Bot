ALTER TABLE "User" ADD COLUMN "scoinBalance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "scoinEarnedTotal" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ScoinTransaction" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScoinTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MusicPlaylistTrack" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "source" TEXT,
    "duration" INTEGER,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MusicPlaylistTrack_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StarInventory" (
    "userId" TEXT NOT NULL,
    "dust" INTEGER NOT NULL DEFAULT 0,
    "small" INTEGER NOT NULL DEFAULT 0,
    "bright" INTEGER NOT NULL DEFAULT 0,
    "comet" INTEGER NOT NULL DEFAULT 0,
    "galaxy" INTEGER NOT NULL DEFAULT 0,
    "lastHuntAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StarInventory_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "StarTool" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StarTool_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StarBuff" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StarBuff_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StarHarvestSession" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "toolKey" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "soldValue" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StarHarvestSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Giveaway" (
    "id" SERIAL NOT NULL,
    "messageId" TEXT,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "prize" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "winnersCount" INTEGER NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "requiredRoleId" TEXT,
    "minLevel" INTEGER,
    "minScoin" INTEGER,
    "entryCost" INTEGER NOT NULL DEFAULT 0,
    "rewardType" TEXT NOT NULL DEFAULT 'contact_host',
    "rewardSecret" TEXT,
    "publicMediaUrl" TEXT,
    "bannerUrl" TEXT,
    "winnerIds" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Giveaway_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GiveawayEntry" (
    "id" SERIAL NOT NULL,
    "giveawayId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "entries" INTEGER NOT NULL DEFAULT 1,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GiveawayEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GiveawayRewardDelivery" (
    "id" SERIAL NOT NULL,
    "giveawayId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GiveawayRewardDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScoinTransaction_userId_idx" ON "ScoinTransaction"("userId");
CREATE INDEX "ScoinTransaction_source_idx" ON "ScoinTransaction"("source");
CREATE INDEX "ScoinTransaction_createdAt_idx" ON "ScoinTransaction"("createdAt");
CREATE UNIQUE INDEX "MusicPlaylistTrack_userId_position_key" ON "MusicPlaylistTrack"("userId", "position");
CREATE INDEX "MusicPlaylistTrack_userId_idx" ON "MusicPlaylistTrack"("userId");
CREATE UNIQUE INDEX "StarTool_userId_key_key" ON "StarTool"("userId", "key");
CREATE INDEX "StarBuff_userId_idx" ON "StarBuff"("userId");
CREATE INDEX "StarBuff_expiresAt_idx" ON "StarBuff"("expiresAt");
CREATE INDEX "StarHarvestSession_userId_idx" ON "StarHarvestSession"("userId");
CREATE UNIQUE INDEX "Giveaway_messageId_key" ON "Giveaway"("messageId");
CREATE INDEX "Giveaway_status_idx" ON "Giveaway"("status");
CREATE INDEX "Giveaway_endsAt_idx" ON "Giveaway"("endsAt");
CREATE UNIQUE INDEX "GiveawayEntry_giveawayId_userId_key" ON "GiveawayEntry"("giveawayId", "userId");
CREATE INDEX "GiveawayEntry_userId_idx" ON "GiveawayEntry"("userId");
CREATE INDEX "GiveawayRewardDelivery_giveawayId_idx" ON "GiveawayRewardDelivery"("giveawayId");
CREATE INDEX "GiveawayRewardDelivery_userId_idx" ON "GiveawayRewardDelivery"("userId");

ALTER TABLE "ScoinTransaction" ADD CONSTRAINT "ScoinTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicPlaylistTrack" ADD CONSTRAINT "MusicPlaylistTrack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StarInventory" ADD CONSTRAINT "StarInventory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StarTool" ADD CONSTRAINT "StarTool_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StarBuff" ADD CONSTRAINT "StarBuff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GiveawayEntry" ADD CONSTRAINT "GiveawayEntry_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GiveawayEntry" ADD CONSTRAINT "GiveawayEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GiveawayRewardDelivery" ADD CONSTRAINT "GiveawayRewardDelivery_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE;
