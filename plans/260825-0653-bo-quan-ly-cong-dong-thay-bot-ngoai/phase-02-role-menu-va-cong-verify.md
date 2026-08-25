# Phase 02 — Role menu + cổng verify

Trạng thái: DONE
Phụ thuộc: không

## Bối Cảnh

- `RoleMenu` (channelId, messageId unique, title, description, mode, style, createdBy) +
  `RoleMenuOption` (menuId, roleId, label, emoji, description, position) đã có
  (`prisma/schema.prisma:756-784`). `mode`: `multi` | `unique` | `verify`.
- `config.roleMenu.maxOptions = 20`.
- Có sẵn mẫu component menu ở `src/systems/skillRoleManager.ts` (`toggleSkillRole`) — cùng
  bài toán (bấm để nhận/bỏ role) nhưng danh sách cố định trong config; phase này là bản
  admin tự dựng được.
- `src/events/interactionCreate.ts` đã có nhánh `isStringSelectMenu()` và `isButton()` để cắm vào.

## Yêu Cầu

1. `/rolemenu create <title> <description> [mode] [style]` → tạo bản nháp, chưa đăng.
2. `/rolemenu add <id> <role> <label> [emoji] [description]` → thêm lựa chọn (trần 20).
3. `/rolemenu remove <id> <role>`, `/rolemenu list`, `/rolemenu delete <id>`.
4. `/rolemenu post <id> [channel]` → đăng menu, lưu `messageId`; đăng lại thì sửa tin cũ
   chứ không tạo tin mới (tránh bỏ lại menu chết mà người ta vẫn bấm được).
5. Bấm → cấp/gỡ role, phản hồi ephemeral. `unique`: gỡ các role khác trong cùng menu.
   `verify`: chỉ cấp, bấm lại không gỡ.
6. `/verify setup <role> [channel] [title] [description]` → tạo menu `mode=verify`,
   `style=button`, 1 lựa chọn, đăng luôn.

## Bảo Mật (phần quan trọng nhất của phase này)

`assertRoleAssignable(guild, role)` phải chặn **tại lúc `/rolemenu add`** và **lại một lần
nữa lúc bấm nút** (role có thể được cấp thêm quyền sau khi đã vào menu):

- `role.managed` → từ chối (role của bot/booster, Discord không cho cấp tay).
- `role.id === guild.id` → từ chối (`@everyone`).
- `role.position >= guild.members.me.roles.highest.position` → từ chối, kèm hướng dẫn kéo role bot lên.
- role có bất kỳ quyền trong: `Administrator`, `ManageGuild`, `ManageRoles`, `ManageChannels`,
  `ManageWebhooks`, `BanMembers`, `KickMembers`, `ModerateMembers`, `MentionEveryone` → từ chối.
  Lý do: một menu công khai cấp role có `ManageRoles` là đường để bất kỳ ai tự lên admin.
- Lệnh yêu cầu `ManageRoles` của người gọi, kiểm lại trong `execute`.

## Files

Tạo:
- `src/systems/rolemenu/role-assignable-gate.ts` — cổng bảo mật ở trên (dùng lại được cho verify).
- `src/systems/rolemenu/rolemenu-store.ts` — CRUD Prisma.
- `src/systems/rolemenu/rolemenu-render.ts` — dựng embed + rows (button ≤ 5/hàng, select ≤ 25).
- `src/systems/rolemenu/rolemenu-handler.ts` — xử lý bấm nút/chọn select.
- `src/commands/rolemenu.ts`, `src/commands/verify.ts`.

Sửa:
- `src/events/interactionCreate.ts` — delegate `rolemenu_*` (button + select).
- `scripts/self-check.js` — assertion cho cổng role.

## Kiểm Chứng

- `npm run build`, `npm test`.
- Thử tay: tạo menu 3 role → post → bấm nhận/bỏ; đổi `unique` → chỉ giữ 1;
  `/rolemenu add` role Admin → bị từ chối; `/verify setup` → bấm 2 lần vẫn còn role.

## Rủi Ro

| Rủi ro | Xử lý |
|---|---|
| Menu cũ vẫn sống sau khi xoá DB row | `/rolemenu delete` xoá luôn tin nhắn đã đăng; nút mồ côi trả lời "menu này đã bị xoá" |
| Role bị xoá khỏi server nhưng còn trong menu | Lúc render bỏ option không tìm thấy role; lúc bấm báo rõ |
| Bấm dồn dập | Phản hồi ephemeral + `member.roles.add/remove` idempotent nên không cần lock |
