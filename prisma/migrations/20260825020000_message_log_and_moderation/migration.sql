-- Log kiểm duyệt: bản sao tin nhắn + lịch sử sửa + hồ sơ kỷ luật + role dính.
--
-- MessageMirror tồn tại vì Discord chỉ trả nội dung tin cũ trong event xoá/sửa
-- KHI tin còn trong cache RAM của bot (mặc định 200 tin/kênh, mất sạch khi restart).
-- Thiếu bảng này thì log "ai xoá tin gì" chỉ còn cái vỏ, mà nội dung mới là thứ
-- duy nhất dùng được để phân xử.
--
-- Prune hai tầng (xem message-mirror.ts): dòng thường dọn sau 14 ngày, dòng đã bị
-- xoá/sửa giữ tới 30 ngày — đó đúng là loại dòng admin quay lại soi.
--
-- ModCase ghi cả hành động mod làm bằng tay (đọc từ audit log realtime), không chỉ
-- hành động qua lệnh bot: hồ sơ chỉ có giá trị nếu nó không có lỗ.
--
-- StickyRole chống né mute: rời server rồi vào lại là cách gỡ mute nhanh nhất và
-- không để lại dấu vết nào trong log Discord.

CREATE TABLE IF NOT EXISTS "MessageMirror" (
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" TEXT,
    "stickerNames" TEXT,
    "replyToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3),
    "editCount" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "mirroredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageMirror_pkey" PRIMARY KEY ("messageId")
);

CREATE TABLE IF NOT EXISTS "MessageVersion" (
    "id" SERIAL NOT NULL,
    "messageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ModCase" (
    "id" SERIAL NOT NULL,
    "targetId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "evidence" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StickyRole" (
    "userId" TEXT NOT NULL,
    "roleIds" TEXT NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StickyRole_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX IF NOT EXISTS "MessageMirror_authorId_createdAt_idx" ON "MessageMirror"("authorId", "createdAt");
CREATE INDEX IF NOT EXISTS "MessageMirror_channelId_createdAt_idx" ON "MessageMirror"("channelId", "createdAt");
CREATE INDEX IF NOT EXISTS "MessageMirror_mirroredAt_idx" ON "MessageMirror"("mirroredAt");
CREATE INDEX IF NOT EXISTS "MessageMirror_deletedAt_idx" ON "MessageMirror"("deletedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "MessageVersion_messageId_version_key" ON "MessageVersion"("messageId", "version");
CREATE INDEX IF NOT EXISTS "MessageVersion_messageId_idx" ON "MessageVersion"("messageId");
CREATE INDEX IF NOT EXISTS "ModCase_targetId_createdAt_idx" ON "ModCase"("targetId", "createdAt");
CREATE INDEX IF NOT EXISTS "ModCase_actorId_idx" ON "ModCase"("actorId");
CREATE INDEX IF NOT EXISTS "ModCase_kind_idx" ON "ModCase"("kind");

DO $$
BEGIN
    ALTER TABLE "MessageVersion"
        ADD CONSTRAINT "MessageVersion_messageId_fkey"
        FOREIGN KEY ("messageId") REFERENCES "MessageMirror"("messageId")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
