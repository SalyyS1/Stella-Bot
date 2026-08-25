-- Quản lý tầng 2: theo dõi, lockdown, autorole, role tạm, highlight, auto-thread.
--
-- Toàn bộ là CREATE TABLE nên bảng bỏ không thì vô hại — rollback chỉ cần revert code.
-- Ngoại lệ duy nhất là "ChannelLock": revert khi đang có kênh bị lockdown thì phải mở
-- khoá tay, vì sau đó bot không còn biết kênh nào chính nó đã khoá.

CREATE TABLE IF NOT EXISTS "WatchTarget" (
    "userId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchTarget_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE IF NOT EXISTS "ChannelLock" (
    "channelId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelLock_pkey" PRIMARY KEY ("channelId")
);

CREATE TABLE IF NOT EXISTS "AutoRole" (
    "roleId" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutoRole_pkey" PRIMARY KEY ("roleId")
);

CREATE TABLE IF NOT EXISTS "TempRole" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TempRole_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Highlight" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,

    CONSTRAINT "Highlight_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AutoThreadChannel" (
    "channelId" TEXT NOT NULL,
    "nameTemplate" TEXT NOT NULL DEFAULT '{user}',
    "archiveMinutes" INTEGER NOT NULL DEFAULT 1440,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutoThreadChannel_pkey" PRIMARY KEY ("channelId")
);

CREATE INDEX IF NOT EXISTS "WatchTarget_expiresAt_idx" ON "WatchTarget"("expiresAt");
CREATE INDEX IF NOT EXISTS "TempRole_expiresAt_idx" ON "TempRole"("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "TempRole_userId_roleId_key" ON "TempRole"("userId", "roleId");
CREATE INDEX IF NOT EXISTS "Highlight_keyword_idx" ON "Highlight"("keyword");
CREATE UNIQUE INDEX IF NOT EXISTS "Highlight_userId_keyword_key" ON "Highlight"("userId", "keyword");
