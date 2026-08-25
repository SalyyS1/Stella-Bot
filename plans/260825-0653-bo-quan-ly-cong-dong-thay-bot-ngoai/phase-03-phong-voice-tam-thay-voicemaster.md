# Phase 03 — Phòng voice tạm (thay VoiceMaster)

Trạng thái: DONE
Phụ thuộc: không

## Bối Cảnh

- `TempVoiceHub` (channelId, categoryId, nameTemplate, userLimit) + `TempVoiceChannel`
  (channelId, hubId, ownerId, locked, hidden) đã có (`prisma/schema.prisma:786-807`).
- `config.tempVoice`: `enabled`, `maxChannels: 30`, `maxPerUser: 1`, `emptyGraceMs: 15_000`.
- **Chưa có** `src/events/voiceStateUpdate.ts` — phase này tạo file đầu tiên cho event đó.
- Bot đã có intent `GuildVoiceStates` (`src/index.ts:25`) cho nhạc → không cần thêm intent.
- Hệ thống nhạc cũng dùng voice; temp voice **không được** chạm kênh của nhạc: chỉ xử lý kênh
  có row trong `TempVoiceChannel` hoặc `TempVoiceHub`.

## Yêu Cầu

1. `/tempvoice setup [category] [name] [limit]` → tạo kênh voice hub "➕ Tạo phòng" và lưu row.
2. Vào hub → bot tạo kênh voice mới trong category, move người đó vào, gán `ownerId`,
   đăng panel điều khiển **trong chat của kênh voice đó** (Discord cho text-in-voice).
3. Panel (chỉ chủ phòng bấm được): `Đổi tên` (modal), `Khoá/Mở`, `Ẩn/Hiện`, `Giới hạn người`
   (modal), `Đuổi người` (select member), `Nhường chủ` (select member).
4. Kênh trống > `emptyGraceMs` → xoá kênh + row. Chủ rời nhưng còn người khác → phòng sống,
   chủ giữ nguyên (nhường tay bằng panel hoặc `Nhường chủ` khi chủ đã rời).
5. Trần: `maxChannels` toàn server, `maxPerUser` mỗi người → vượt thì báo và không tạo.
6. Lúc bot lên (`ready`): quét mọi row `TempVoiceChannel` — kênh không còn tồn tại thì xoá row,
   kênh còn mà rỗng thì xoá kênh. Không có bước này thì mỗi lần restart để lại phòng rác vĩnh viễn.
7. `/tempvoice remove <hub>` xoá hub; `/tempvoice list` xem phòng đang mở.

## Bảo Mật

- Panel kiểm `ownerId` từ **DB** mỗi lần bấm, không đọc từ `customId` (customId nằm trong tay client).
- Chủ phòng chỉ được sửa `PermissionOverwrites` của phòng mình, và chỉ 3 quyền:
  `Connect` (khoá), `ViewChannel` (ẩn), `userLimit`. Không mở đường sửa quyền tuỳ ý.
- Không cho đuổi/nhường cho người có `ManageChannels` trở lên — nếu không, một member tạo phòng
  rồi đuổi mod ra khỏi phòng của chính họ.
- Số kênh bot tạo có trần cứng; vượt trần thì từ chối chứ không xoá phòng của người khác.

## Files

Tạo:
- `src/systems/tempvoice/tempvoice-store.ts` — CRUD hub/channel.
- `src/systems/tempvoice/tempvoice-service.ts` — tạo phòng, dọn phòng, grace timer, reconcile lúc boot.
- `src/systems/tempvoice/tempvoice-panel.ts` — dựng panel + xử lý nút/modal/select.
- `src/events/voiceStateUpdate.ts`.
- `src/commands/tempvoice.ts`.

Sửa:
- `src/events/interactionCreate.ts` — delegate `tvc_*` (button, modal, user select).
- `src/events/ready.ts` — gọi `reconcileTempVoiceChannels(guild)`.
- `scripts/self-check.js` — assertion: reconcile có mặt trong ready, panel kiểm owner từ DB.

## Kiểm Chứng

- `npm run build`, `npm test`.
- Thử tay: vào hub → có phòng + panel; khoá phòng → người khác không join được; rời hết →
  15s sau phòng mất; kill bot lúc đang có phòng → start lại → phòng rỗng bị dọn.
- Người khác bấm panel → "Chỉ chủ phòng dùng được".

## Rủi Ro

| Rủi ro | Xử lý |
|---|---|
| Join-leave liên tục tạo hàng loạt kênh | `maxChannels` + `maxPerUser` + grace timer |
| Xoá kênh của hệ thống nhạc | Chỉ xử lý kênh có row trong bảng temp voice |
| Grace timer mất khi restart | `reconcile` lúc boot dọn nốt |
| Thiếu quyền `ManageChannels` | Báo rõ ở `/tempvoice setup` thay vì fail im |
