-- Trạng thái đơn hàng. Mặc định DELIVERED cho các đơn cũ: chúng là đơn role màu
-- đã cấp xong, nên coi là đã giao là đúng thực tế.
--
-- Trạng thái là thứ chặn "hoàn xu rồi vẫn đổi được hàng": không có nó, đường hoàn
-- xu và đường nhận hàng là hai đường độc lập và đi cả hai là được hàng miễn phí.
ALTER TABLE "ShopPurchase" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'DELIVERED';
ALTER TABLE "ShopPurchase" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);

-- Tra cứu "người này đã mua món này chưa" là truy vấn nóng của cả /shop redeem và
-- bước chặn mua trùng hàng số.
CREATE INDEX IF NOT EXISTS "ShopPurchase_userId_itemKey_idx" ON "ShopPurchase"("userId", "itemKey");
