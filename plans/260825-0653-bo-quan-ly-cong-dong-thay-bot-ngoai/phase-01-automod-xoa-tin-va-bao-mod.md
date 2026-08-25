# Phase 01 — Automod: xoá tin + báo mod (không tự phạt)

Trạng thái: DONE
Phụ thuộc: không

## Bối Cảnh

- Bảng `AutomodSetting` (guildId, enabled, rules JSON, exemptRoleIds, exemptChannelIds) và
  `AutomodStrike` (userId, rule, channelId, createdAt) đã có trong `prisma/schema.prisma:730-751`.
- Ngưỡng mặc định 11 luật đã có ở `config.automod.defaults` (`src/config.ts`).
- `src/events/messageCreate.ts` là pipeline duy nhất cho tin nhắn; automod phải chen vào
  **sau** `mirrorMessage` (để log còn giữ bản sao tin bị automod xoá) và **trước** XP/mọi
  handler khác (để tin vi phạm không vừa bị xoá vừa được cộng XP).
- `src/systems/moderation/mod-actions.ts` có sẵn `timeoutMember` + `assertCanModerate` để
  nút "Timeout" của mod dùng lại — không viết lại logic thứ bậc role.
- `src/systems/logs/message-log-sender.ts` gửi embed có nút; dùng nó, không dùng `sendAdminLog`
  (hàm đó không nhận components).

## Yêu Cầu

1. 11 luật: `flood`, `duplicate`, `massMention`, `caps`, `inviteLink`, `links`, `scamLink`,
   `emojiSpam`, `newlineSpam`, `bannedWords`, `zalgo`.
2. Bật/tắt từng luật **runtime** qua `/automod`, ghi vào `AutomodSetting.rules`, không cần deploy.
3. Vi phạm → xoá tin + nhắc riêng người vi phạm (tin tự xoá sau 8s) + ghi `AutomodStrike`.
4. Chạm mốc strike (3/5/8 trong 10 phút) → embed cảnh báo ở kênh log kèm nút
   `Timeout 10p` / `Timeout 1h` / `Warn` / `Bỏ qua`. **Bot không tự phạt.**
5. Miễn trừ: role trong `exemptRoleIds` + `config.automod.exemptRoleIds`, ai có
   `ManageMessages`, kênh trong `exemptChannelIds`, và bot.
6. Gộp log: một người chạm cùng một luật nhiều lần trong 60s chỉ sinh **một** embed log
   (đếm số lần trong embed) — nếu không thì đúng một đợt flood sẽ làm ngập chính kênh log.

## Files

Tạo:
- `src/systems/automod/automod-rules.ts` — hàm thuần: nội dung + tham số → vi phạm | null. Không biết discord.js.
- `src/systems/automod/automod-settings.ts` — merge config.defaults + DB, cache 60s, đọc/ghi.
- `src/systems/automod/automod-strikes.ts` — ghi strike, đếm trong cửa sổ, quyết định mốc cảnh báo.
- `src/systems/automod/automod-service.ts` — điều phối: `runAutomod(message) → boolean`.
- `src/systems/automod/automod-alert.ts` — dựng embed cảnh báo + nút, xử lý nút của mod.
- `src/commands/automod.ts` — `/automod status|on|off|rule|exempt|strikes`.
- `tests/automod-rules.test.ts` — test luật thuần (không cần Discord).

Sửa:
- `src/events/messageCreate.ts` — chèn `if (await runAutomod(message)) return;`.
- `src/events/interactionCreate.ts` — 4 dòng delegate `automod_*` sang `automod-alert`.
- `src/config.ts` — thêm `automod.autoPunish = false` + `automod.alertDedupeMs`.
- `package.json` — script `test:automod`.
- `scripts/self-check.js` — assertion: automod chạy sau mirror, không tự timeout khi `autoPunish=false`.

## Chi Tiết Luật

| Luật | Bắt gì | Tham số mặc định |
|---|---|---|
| flood | N tin trong M giây (đếm theo người, mọi kênh) | 6 tin / 5s |
| duplicate | cùng nội dung lặp lại | 3 lần / 30s |
| massMention | số mention user+role trong 1 tin | > 6 |
| caps | tỷ lệ CHỮ HOA | ≥ 75% với tin ≥ 12 ký tự |
| inviteLink | `discord.gg/…`, `discord.com/invite/…` | — |
| links | mọi http(s) không nằm trong allowHosts | tắt mặc định |
| scamLink | danh sách domain lừa đảo | bật |
| emojiSpam | số emoji trong 1 tin | > 12 |
| newlineSpam | số dòng trong 1 tin | > 15 |
| bannedWords | khớp **theo từ** (word boundary), không khớp giữa từ | tắt, danh sách trống |
| zalgo | mật độ ký tự combining | bật |

`flood` và `duplicate` cần trạng thái theo người → giữ trong RAM (Map, tự dọn), không ghi DB:
đếm tin nhắn là việc phải nhanh hơn một round-trip DB.

## Kiểm Chứng

- `npm run build`, `npm test`.
- `node --require ts-node/register --test tests/automod-rules.test.ts` — caps không chặn "OK",
  bannedWords không chặn "bedeck" khi cấm "bede", zalgo không chặn tiếng Việt có dấu.
- Thử tay: spam 7 tin → bị xoá + log gộp; mod spam → không bị chặn; `/automod off` → tắt hẳn.

## Rủi Ro

| Rủi ro | Xử lý |
|---|---|
| Chặn oan tiếng Việt (dấu bị đếm là combining char như zalgo) | Test riêng cho tiếng Việt có dấu; ngưỡng zalgo tính theo mật độ combining **trên mỗi ký tự gốc**, tiếng Việt tối đa 1 dấu/ký tự |
| Automod xoá tin của chính bot | Chặn `author.bot` ngay đầu |
| Log ngập lúc raid | Gộp theo (user, rule) trong 60s |
| Race: xoá tin rồi mirror chưa kịp ghi | `mirrorMessage` chạy trước automod trong cùng pipeline |
