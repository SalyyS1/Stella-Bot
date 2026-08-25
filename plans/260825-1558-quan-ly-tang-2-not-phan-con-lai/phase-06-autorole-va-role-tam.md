# Phase 06 — Autorole + role tạm có hạn

Trạng thái: DONE
Phụ thuộc: P5 (migration)

## 5. Autorole lúc join

- `/autorole add <role>` / `remove <role>` / `list` — `ManageRoles`.
- Cấp trong `guildMemberAdd`, **sau** `restoreStickyRoles` (role kỷ luật phải về trước) và
  bỏ qua bot.
- Mỗi role đi qua `checkRoleAssignable` **hai lần**: lúc `/autorole add` và lúc cấp cho
  từng người. Role có thể được cấp thêm quyền sau khi đã vào danh sách — và autorole cấp
  cho MỌI người vào server, nên sai chỗ này là mọi acc mới đều thành mod.
- Người đang bị sticky-role kỷ luật thì **vẫn** nhận autorole: autorole thường chỉ là role
  "Member" dùng để mở kênh, còn việc khoá miệng do role kỷ luật lo.

## 6. Role tạm có hạn

- `/role add @user @role <thời lượng> [lý do]` · `/role remove @user @role` ·
  `/role list [@user]` — `ManageRoles`.
- Dùng `parseDurationMs` có sẵn (`src/utils/parse-duration.ts`), trần 365 ngày.
- Bảng `TempRole` unique `(userId, roleId)` → gia hạn là ghi đè `expiresAt`, không tạo dòng thứ hai.
- Scheduler riêng nhịp 60s (`startTempRoleScheduler`): gỡ role đã hết hạn, xoá dòng.
  Nhịp 60s vì độ chính xác phút là đủ cho role tạm, mà mỗi tick phải fetch member.
- Lúc bot lên: chạy một lượt ngay, không chờ tick đầu — role đáng ra hết hạn lúc bot đang
  tắt phải được gỡ ngay khi bot lên, không phải một phút sau.
- Role bị xoá khỏi server / member đã rời → xoá dòng, không log lỗi ầm ĩ.
- Cùng cổng `checkRoleAssignable`.

## Files

Tạo: `src/systems/roles/autorole-manager.ts`, `src/systems/roles/temp-role-manager.ts`,
`src/commands/autorole.ts`, `src/commands/role.ts`

Sửa: `src/events/guildMemberAdd.ts`, `src/events/ready.ts`, `scripts/self-check.js`

## Kiểm Chứng

- `/autorole add @Admin` → bị từ chối kèm lý do.
- `/role add @u @r 2m` → sau 2 phút role bị gỡ; kill bot ngay sau khi đặt rồi start lại
  sau 3 phút → role được gỡ ngay lúc bot lên.

## Rủi Ro

| Rủi ro | Xử lý |
|---|---|
| Autorole phát role quyền cao | `checkRoleAssignable` hai lần |
| Scheduler gỡ role sai người | Query theo `expiresAt <= now`, gỡ đúng `roleId` đã ghi |
| Bot tắt lâu, hàng loạt role hết hạn | Chạy một lượt lúc boot, gỡ theo lô, lỗi từng người không chặn cả lô |
