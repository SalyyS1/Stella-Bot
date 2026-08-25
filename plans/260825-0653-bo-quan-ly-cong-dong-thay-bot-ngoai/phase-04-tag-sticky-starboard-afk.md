# Phase 04 — Tag/autoresponder, sticky, starboard, AFK

Trạng thái: DONE
Phụ thuộc: không

## Bối Cảnh

- `Tag` (name PK lowercase, content, autoTrigger, uses, createdBy), `StickyMessage`
  (channelId PK, content, lastMessageId, minGap, pending), `StarboardPost`
  (sourceMessageId PK, starboardMessageId, sourceChannelId, authorId, stars),
  `AfkStatus` (userId PK, reason, since) — đã có (`prisma/schema.prisma:809-849`).
- `config.utility`: `tags.maxContentLength/autoCooldownMs`, `sticky.defaultMinGap`,
  `starboard.{enabled,channelId,emoji,threshold,allowSelfStar}`, `afk.maxReasonLength`.
- `src/events/messageReactionAdd.ts` / `messageReactionRemove.ts` đã có (đang gọi voteManager)
  → cắm starboard vào đó. **Lưu ý chữ ký**: `(reaction, user, _details, client)` — tham số
  `_details` phải khai báo, nếu không `client` bind sai (đã ghi rõ trong comment 2 file đó).
- `config.utility.starboard.channelId` để trống = tắt → cần đường set runtime:
  dùng `prisma.managedChannel` key `"starboard"` (bảng KV có sẵn, `skillRoleManager.ts` đã
  dùng cùng cách cho role id).
- `messageCreate.ts` là nơi cắm autoresponder + sticky + AFK-clear.

## Yêu Cầu

### Tag (thay tag Carl-bot / custom command Dyno)
- `/tag create|edit|delete|show|list|info`, `/tag trigger <name> <từ khoá|off>`.
- `!tag <name>` cũng gọi được (prefix quen tay của Carl-bot) — nhưng chỉ khi tag tồn tại.
- Autoresponder: tin nhắn thường chứa `autoTrigger` (khớp theo từ, không khớp giữa từ) →
  bot trả lời nội dung tag; cooldown `autoCooldownMs` **theo kênh** để không thành máy spam.
- Đếm `uses`.

### Sticky (thay sticky Carl-bot)
- `/sticky set <content> [minGap]`, `/sticky remove`, `/sticky list`.
- Sau mỗi `minGap` tin trong kênh → xoá bản sticky cũ, đăng bản mới xuống cuối.
- `pending` đếm trong DB (không RAM) để restart không làm sticky nhảy lung tung.

### Starboard (thay starboard Carl-bot)
- `/starboard setup <channel> [threshold]`, `/starboard off`, `/starboard status`.
- Thả `config.utility.starboard.emoji` đạt ngưỡng → đăng embed vào kênh starboard
  (tác giả, nội dung, ảnh đầu tiên, link tới tin gốc, số sao).
- Số sao đổi → sửa tin starboard; xuống dưới ngưỡng → xoá tin starboard + row.
- Không tính sao của chính tác giả (`allowSelfStar=false`), không tính sao của bot,
  không starboard tin trong kênh starboard.

### AFK (thay AFK Dyno/ProBot)
- `/afk [lý do]` → lưu trạng thái, thêm `[AFK]` vào nickname nếu bot đổi được.
- Ai ping người AFK → bot trả lời gọn "người này đang AFK từ <t:…:R>: lý do", gộp tối đa
  1 lần/kênh/30s.
- Người AFK chat lại → xoá trạng thái, trả nickname, nhắc riêng "đã tắt AFK" (tự xoá sau 8s).

## Bảo Mật

- **Mọi nội dung do admin nhập (tag, sticky) gửi với `allowedMentions: { parse: [] }`.**
  Không có dòng này thì `/tag create` là công cụ ping `@everyone` cho mọi người có quyền tạo tag.
- `/tag create|edit|delete`, `/sticky *`, `/starboard *` yêu cầu `ManageMessages` (kiểm lại trong `execute`).
- Starboard embed **không ping** tác giả (dùng text `<@id>` trong description với `parse: []`).
- AFK: lý do bị cắt `maxReasonLength` và strip mention — lý do AFK là thứ hiện ra cho người khác đọc.
- Autoresponder không phản hồi bot và không phản hồi trong kênh đã bị `logs.ignoreChannelIds`.

## Files

Tạo:
- `src/systems/utility/tag-store.ts`, `src/systems/utility/tag-autoresponder.ts`
- `src/systems/utility/sticky-manager.ts`
- `src/systems/utility/starboard-manager.ts`
- `src/systems/utility/afk-manager.ts`
- `src/commands/tag.ts`, `src/commands/sticky.ts`, `src/commands/starboard.ts`, `src/commands/afk.ts`

Sửa:
- `src/events/messageCreate.ts` — 3 hook: `clearAfkOnMessage`, `notifyAfkMentions`,
  `handleTagTrigger`, `bumpSticky` (đặt sau automod, trước XP).
- `src/events/messageReactionAdd.ts` / `messageReactionRemove.ts` — gọi starboard.
- `src/events/messageDelete.ts` — tin gốc bị xoá thì dọn row starboard.
- `scripts/self-check.js` — assertion: `parse: []` có mặt ở tag/sticky/starboard.

## Kiểm Chứng

- `npm run build`, `npm test`.
- Thử tay: tag có trigger trả lời đúng 1 lần rồi im 30s; sticky đăng lại sau 5 tin và
  không nhân đôi; ⭐ đủ ngưỡng lên starboard, bỏ sao thì mất; `/afk` rồi được ping → bot nhắc.
- `/tag create` nội dung chứa `@everyone` → gửi ra không ping ai.

## Rủi Ro

| Rủi ro | Xử lý |
|---|---|
| Sticky đua với chat, spam kênh | `minGap` + chỉ giữ 1 bản (xoá bản cũ trước khi đăng) |
| Autoresponder vòng lặp bot-với-bot | Bỏ qua `author.bot` |
| Starboard nhân đôi khi 2 người thả sao cùng lúc | `sourceMessageId` là PK → upsert, không insert |
| AFK nickname không trả lại được (thiếu quyền) | Fail mềm, chỉ mất phần nickname |
