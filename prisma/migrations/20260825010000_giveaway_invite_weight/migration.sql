-- Giveaway ưu tiên tỷ lệ theo lượt mời.
--
-- Mặc định "none" là cố ý: giveaway đang chạy lúc migrate không bị đổi luật giữa
-- cuộc chơi. Cột `entries` của GiveawayEntry đã tồn tại từ trước nhưng chưa từng
-- được đọc/ghi — nay nó mang nghĩa "số vé", nên giveaway cũ giữ nguyên 1 vé/người
-- và kết quả quay không lệch so với trước.
--
-- inviteWeightCap tồn tại để "ưu tiên" không biến thành "chắc chắn trúng": không
-- có trần thì một người mời 200 người sẽ chiếm gần hết rổ vé và mọi người khác
-- hiểu ra là mình không có cơ hội — giveaway mất luôn tác dụng thu hút.

ALTER TABLE "Giveaway" ADD COLUMN IF NOT EXISTS "inviteBonusMode" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Giveaway" ADD COLUMN IF NOT EXISTS "inviteWeightPer" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Giveaway" ADD COLUMN IF NOT EXISTS "inviteWeightCap" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "Giveaway" ADD COLUMN IF NOT EXISTS "inviteCountFrom" TIMESTAMP(3);
