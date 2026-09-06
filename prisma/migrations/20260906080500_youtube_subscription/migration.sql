-- Kênh YouTube được theo dõi để báo video mới (đọc RSS công khai, không key).
--
-- CREATE TABLE IF NOT EXISTS nên chạy lại vô hại, và bảng bỏ không thì không ảnh hưởng gì —
-- rollback chỉ cần revert code.

CREATE TABLE IF NOT EXISTS "YoutubeSubscription" (
    "ytChannelId" TEXT NOT NULL,
    "ytTitle" TEXT NOT NULL,
    "discordChannelId" TEXT NOT NULL,
    "pingRoleId" TEXT,
    "addedBy" TEXT NOT NULL,
    "lastVideoId" TEXT,
    "lastPublishedAt" TIMESTAMP(3),
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YoutubeSubscription_pkey" PRIMARY KEY ("ytChannelId")
);
