-- Hệ thống mời (invite tracking).
--
-- Vì sao cần InviteCache: Discord KHÔNG cho biết invite nào vừa được dùng khi một
-- member join. Cách duy nhất là giữ ảnh chụp `uses` của mọi invite rồi fetch lại
-- lúc join để tìm mã nào tăng. Ảnh chụp phải nằm ở DB chứ không phải RAM, vì mất
-- nó là mất khả năng quy lượt mời cho tới lần fetch kế tiếp.
--
-- Vì sao InviteJoin lấy invitedId làm khoá chính: một người chỉ được tính một lần
-- dù vào/rời bao nhiêu lần. Đặt chốt này ở hình dạng bảng thì mọi nhánh code đều
-- bị chặn, còn đặt ở tầng code thì chỉ chặn được nhánh nào nhớ kiểm tra.
--
-- Vì sao InviteBackfill tách riêng và đóng băng: số lượt mời quá khứ chỉ suy ra
-- được từ tổng `uses` của các invite còn tồn tại (invite đã xoá thì mất vĩnh viễn).
-- Sau khi hệ thống chạy, `uses` tiếp tục tăng và những lượt đó đã được đếm chính
-- xác ở InviteJoin.VERIFIED — quét lại rồi cộng hai nguồn là đếm đôi. Nên con số
-- này được ghi MỘT LẦN, và lệnh rescan cố ý không chạm vào nó.

CREATE TABLE IF NOT EXISTS "InviteCache" (
    "code" TEXT NOT NULL,
    "inviterId" TEXT,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InviteCache_pkey" PRIMARY KEY ("code")
);

CREATE TABLE IF NOT EXISTS "InviteJoin" (
    "invitedId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "code" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "accountCreatedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolePickedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "rejoinCount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "InviteJoin_pkey" PRIMARY KEY ("invitedId")
);

CREATE TABLE IF NOT EXISTS "InviteBackfill" (
    "inviterId" TEXT NOT NULL,
    "legacyUses" INTEGER NOT NULL DEFAULT 0,
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InviteBackfill_pkey" PRIMARY KEY ("inviterId")
);

CREATE INDEX IF NOT EXISTS "InviteCache_inviterId_idx" ON "InviteCache"("inviterId");
CREATE INDEX IF NOT EXISTS "InviteJoin_inviterId_status_idx" ON "InviteJoin"("inviterId", "status");
CREATE INDEX IF NOT EXISTS "InviteJoin_status_joinedAt_idx" ON "InviteJoin"("status", "joinedAt");
