-- Ticket/modmail, kênh thống kê, thời gian voice.
--
-- Toàn bộ CREATE TABLE nên bảng bỏ không thì vô hại. Ngoại lệ: revert code khi đang có
-- kênh ticket mở thì phải xoá tay các kênh đó — sau đó bot không còn biết kênh nào là ticket.

CREATE TABLE IF NOT EXISTS "TicketConfig" (
    "guildId" TEXT NOT NULL,
    "categoryId" TEXT,
    "staffRoleId" TEXT,
    "panelChannelId" TEXT,
    "panelMessageId" TEXT,
    "maxPerUser" INTEGER NOT NULL DEFAULT 2,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketConfig_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE IF NOT EXISTS "Ticket" (
    "id" SERIAL NOT NULL,
    "channelId" TEXT NOT NULL,
    "openerId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "claimedBy" TEXT,
    "closedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StatsChannel" (
    "channelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatsChannel_pkey" PRIMARY KEY ("channelId")
);

CREATE TABLE IF NOT EXISTS "VoiceActivity" (
    "userId" TEXT NOT NULL,
    "totalSeconds" INTEGER NOT NULL DEFAULT 0,
    "weekKey" TEXT NOT NULL,
    "weekSeconds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceActivity_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_channelId_key" ON "Ticket"("channelId");
CREATE INDEX IF NOT EXISTS "Ticket_openerId_closedAt_idx" ON "Ticket"("openerId", "closedAt");
CREATE INDEX IF NOT EXISTS "VoiceActivity_totalSeconds_idx" ON "VoiceActivity"("totalSeconds");
CREATE INDEX IF NOT EXISTS "VoiceActivity_weekKey_weekSeconds_idx" ON "VoiceActivity"("weekKey", "weekSeconds");
