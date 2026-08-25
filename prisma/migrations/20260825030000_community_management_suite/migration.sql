-- Bộ quản lý cộng đồng: automod, menu role, phòng voice tạm, tag, sticky, starboard, AFK.
--
-- Mục tiêu của đợt này là gỡ được các bot ngoài (Carl-bot, Dyno, ProBot, VoiceMaster)
-- nên schema phải phủ đúng những thứ các bot đó giữ hộ dữ liệu: cấu hình automod,
-- menu nhận role, phòng voice đang mở, tag/autoresponder, sticky message, starboard.
--
-- AutomodSetting để ở DB (khác với phần còn lại của bot vốn cấu hình trong config.ts)
-- vì automod là thứ phải tắt/bật GIỮA một đợt spam — sửa config.ts thì phải deploy lại.
-- `rules` là JSON thay vì 30 cột: thêm một luật mới không nên cần migration.
--
-- TempVoiceChannel phải nằm ở DB chứ không chỉ trong RAM: bot restart giữa lúc có
-- nhiều phòng đang mở thì cần biết phòng nào là của mình để dọn, nếu không những
-- phòng rỗng đó sống mãi và server đầy kênh rác.

CREATE TABLE IF NOT EXISTS "AutomodSetting" (
    "guildId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rules" TEXT NOT NULL,
    "exemptRoleIds" TEXT,
    "exemptChannelIds" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomodSetting_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE IF NOT EXISTS "AutomodStrike" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "channelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomodStrike_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RoleMenu" (
    "id" SERIAL NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'multi',
    "style" TEXT NOT NULL DEFAULT 'button',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleMenu_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RoleMenuOption" (
    "id" SERIAL NOT NULL,
    "menuId" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "emoji" TEXT,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RoleMenuOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TempVoiceHub" (
    "channelId" TEXT NOT NULL,
    "categoryId" TEXT,
    "nameTemplate" TEXT NOT NULL DEFAULT '🔊 Phòng của {user}',
    "userLimit" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TempVoiceHub_pkey" PRIMARY KEY ("channelId")
);

CREATE TABLE IF NOT EXISTS "TempVoiceChannel" (
    "channelId" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TempVoiceChannel_pkey" PRIMARY KEY ("channelId")
);

CREATE TABLE IF NOT EXISTS "Tag" (
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "autoTrigger" TEXT,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("name")
);

CREATE TABLE IF NOT EXISTS "StickyMessage" (
    "channelId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "lastMessageId" TEXT,
    "minGap" INTEGER NOT NULL DEFAULT 5,
    "pending" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StickyMessage_pkey" PRIMARY KEY ("channelId")
);

CREATE TABLE IF NOT EXISTS "StarboardPost" (
    "sourceMessageId" TEXT NOT NULL,
    "starboardMessageId" TEXT NOT NULL,
    "sourceChannelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StarboardPost_pkey" PRIMARY KEY ("sourceMessageId")
);

CREATE TABLE IF NOT EXISTS "AfkStatus" (
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AfkStatus_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX IF NOT EXISTS "AutomodStrike_userId_createdAt_idx" ON "AutomodStrike"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AutomodStrike_createdAt_idx" ON "AutomodStrike"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "RoleMenu_messageId_key" ON "RoleMenu"("messageId");
CREATE UNIQUE INDEX IF NOT EXISTS "RoleMenuOption_menuId_roleId_key" ON "RoleMenuOption"("menuId", "roleId");
CREATE INDEX IF NOT EXISTS "RoleMenuOption_menuId_idx" ON "RoleMenuOption"("menuId");
CREATE INDEX IF NOT EXISTS "TempVoiceChannel_ownerId_idx" ON "TempVoiceChannel"("ownerId");
CREATE INDEX IF NOT EXISTS "Tag_autoTrigger_idx" ON "Tag"("autoTrigger");
CREATE INDEX IF NOT EXISTS "StarboardPost_authorId_idx" ON "StarboardPost"("authorId");

DO $$
BEGIN
    ALTER TABLE "RoleMenuOption"
        ADD CONSTRAINT "RoleMenuOption_menuId_fkey"
        FOREIGN KEY ("menuId") REFERENCES "RoleMenu"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
