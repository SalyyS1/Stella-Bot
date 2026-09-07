-- IGN tự khai cho thẻ hồ sơ (`/mc ign set`). Cột nullable, thêm vào bảng đã có nên không
-- đụng dữ liệu cũ; revert code là đủ, cột bỏ không thì vô hại.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "minecraftIgn" TEXT;
