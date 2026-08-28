-- Đơn hàng freelancer: giá có cấu trúc, hạn, ảnh tham khảo, kênh riêng của đơn,
-- và hồ sơ nhận việc (bảng giá + trạng thái).
--
-- Toàn bộ là ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS nên chạy lại vô hại.
-- Cột "budget" (TEXT, nguyên văn người dùng gõ) GIỮ NGUYÊN, không drop: đơn cũ có dữ liệu
-- ở đó và drop là mất. "budgetAmount" là dữ liệu đã chuẩn hoá, hai cột phục vụ hai việc.
--
-- Revert code khi đang có kênh đơn mở thì phải xoá kênh tay — sau đó bot không còn biết
-- kênh nào là kênh đơn.

ALTER TABLE "RequestPost" ADD COLUMN IF NOT EXISTS "budgetAmount" INTEGER;
ALTER TABLE "RequestPost" ADD COLUMN IF NOT EXISTS "budgetCurrency" TEXT;
ALTER TABLE "RequestPost" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);
ALTER TABLE "RequestPost" ADD COLUMN IF NOT EXISTS "ticketChannelId" TEXT;
ALTER TABLE "RequestPost" ADD COLUMN IF NOT EXISTS "referenceUrls" TEXT;

CREATE TABLE IF NOT EXISTS "FreelancerProfile" (
    "userId" TEXT NOT NULL,
    "openForWork" BOOLEAN NOT NULL DEFAULT true,
    "headline" TEXT,
    "priceText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreelancerProfile_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RequestPost_ticketChannelId_key" ON "RequestPost"("ticketChannelId");
CREATE INDEX IF NOT EXISTS "RequestPost_budgetAmount_idx" ON "RequestPost"("budgetAmount");
CREATE INDEX IF NOT EXISTS "RequestPost_dueDate_idx" ON "RequestPost"("dueDate");
CREATE INDEX IF NOT EXISTS "FreelancerProfile_openForWork_idx" ON "FreelancerProfile"("openForWork");
