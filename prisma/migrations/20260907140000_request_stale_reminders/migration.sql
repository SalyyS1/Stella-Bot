-- Mốc nhắc của đơn hàng: nhắc đơn OPEN bỏ hoang và nhắc khách đánh giá đơn DONE.
--
-- Hai cột nullable thêm vào bảng đã có, không đụng dữ liệu cũ. Đơn cũ có NULL = chưa nhắc
-- lần nào, đúng ngữ nghĩa mong muốn: lượt quét đầu tiên sẽ nhắc chứ không đóng thẳng.
-- Rollback: revert code, cột bỏ không thì vô hại.

ALTER TABLE "RequestPost" ADD COLUMN IF NOT EXISTS "staleRemindedAt" TIMESTAMP(3);
ALTER TABLE "RequestPost" ADD COLUMN IF NOT EXISTS "rateRemindedAt" TIMESTAMP(3);
