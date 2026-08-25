# Phase 05 — Migration + kiểm duyệt nâng cao

Trạng thái: DONE
Gồm: log voice · cảnh báo acc lạ lúc join · `/watch` · `/lockdown` + `/slowmode`

## Migration (cho cả 4 phase)

`prisma/migrations/20260825040000_management_tier2/migration.sql` — 6 bảng, toàn bộ
`CREATE TABLE IF NOT EXISTS` theo đúng mẫu migration trước:

```prisma
model WatchTarget {
  userId    String   @id
  actorId   String
  reason    String
  expiresAt DateTime
  createdAt DateTime @default(now())
  @@index([expiresAt])
}

model ChannelLock {
  channelId String   @id
  actorId   String
  reason    String?
  createdAt DateTime @default(now())
}

model AutoRole {
  roleId    String   @id
  addedBy   String
  createdAt DateTime @default(now())
}

model TempRole {
  id        Int      @id @default(autoincrement())
  userId    String
  roleId    String
  expiresAt DateTime
  grantedBy String
  createdAt DateTime @default(now())
  @@unique([userId, roleId])
  @@index([expiresAt])
}

model Highlight {
  id      Int    @id @default(autoincrement())
  userId  String
  keyword String
  @@unique([userId, keyword])
  @@index([keyword])
}

model AutoThreadChannel {
  channelId      String   @id
  nameTemplate   String   @default("{user}")
  archiveMinutes Int      @default(1440)
  createdBy      String
  createdAt      DateTime @default(now())
}
```

## 1. Log voice

- Cắm vào `src/events/voiceStateUpdate.ts` đã có (temp voice đang dùng) — **không** tạo
  event thứ hai cho cùng một event.
- Gộp theo phiên: giữ `Map<userId, {channelId, joinedAt}>` trong RAM, chỉ log **một** dòng
  khi rời/chuyển kênh, kèm thời lượng. Log cả hai chiều thì mỗi lần ai đó đổi kênh sinh
  hai dòng và kênh log thành nhật ký di chuyển vô nghĩa.
- Bỏ qua bot (bot nhạc vào/ra voice liên tục) và bỏ qua kênh phòng voice tạm của chính bot?
  **Không** bỏ — phòng tạm cũng là chỗ cần soi. Chỉ bỏ bot.
- Tắt được bằng `config.logs.voice.enabled`.

## 2. Cảnh báo acc lạ lúc join

- Cắm vào `guildMemberAdd.ts` (đã có `attribution.accountAgeDays`).
- Điều kiện: tuổi acc < `config.invites.minAccountAgeDays` **hoặc** không avatar
  **hoặc** tên khớp mẫu spam (`\d{4,}$`, chuỗi ký tự ngẫu nhiên).
- Embed cam ở kênh log kèm nút `Kick` / `Ban` / `Bỏ qua` → `joinrisk_<action>_<userId>`.
- Nút dùng lại `kickMember`/`banMember` của `mod-actions.ts` (đã tự kiểm thứ bậc role,
  tự ghi `ModCase`, tự đăng ký với anti-raid). Yêu cầu người bấm có `KickMembers`.

## 3. `/watch @user <thời hạn> <lý do>`

- Administrator-only. Trần 30 ngày. Luôn ghi `ModCase` kind `WATCH` khi bật.
- Cắm vào `messageCreate` (sau automod): người trong danh sách watch thì copy tin sang log.
- Cache tập id trong RAM (TTL 60s) — hàm này chạy trên mọi tin nhắn.
- Hết hạn: kiểm ngay trong hàm đọc cache, không cần scheduler.
- `/watch list`, `/watch off @user`.

## 4. `/lockdown` + `/slowmode`

- `/lockdown on [channel] [reason]` → ghi `SendMessages: false` cho `@everyone`, lưu `ChannelLock`.
- `/lockdown off [channel]` → **xoá** overwrite (`SendMessages: null`), xoá row.
  Set `true` sẽ ghi đè cấu hình gốc của kênh mà không ai biết trước đó nó là gì.
- `/lockdown all` / `/lockdown lift` → khoá/mở mọi kênh text đang thấy được. Có xác nhận.
- `/slowmode <giây> [channel]` — 0 = tắt, trần 21600 (giới hạn Discord).
- Cả hai yêu cầu `ManageChannels`, và đều đăng log ai làm gì.

## Files

Tạo: `prisma/migrations/20260825040000_management_tier2/migration.sql`,
`src/systems/logs/voice-log.ts`, `src/systems/moderation/join-risk-alert.ts`,
`src/systems/moderation/watch-manager.ts`, `src/systems/moderation/channel-lock.ts`,
`src/commands/watch.ts`, `src/commands/lockdown.ts`, `src/commands/slowmode.ts`

Sửa: `prisma/schema.prisma`, `src/config.ts` (`logs.voice`, `moderation.watchMaxDays`),
`src/events/voiceStateUpdate.ts`, `src/events/guildMemberAdd.ts`,
`src/events/messageCreate.ts`, `src/events/interactionCreate.ts`, `scripts/self-check.js`

## Rủi Ro

| Rủi ro | Xử lý |
|---|---|
| Log voice quá ồn | Gộp theo phiên, một dòng khi rời; tắt được bằng config |
| Nút Kick/Ban bị bấm nhầm | Dùng `assertCanModerate`; nút disable sau khi bấm; luôn có `ModCase` |
| `/watch` thành công cụ theo dõi vô cớ | Administrator-only + `ModCase` + trần 30 ngày + tự tắt |
| `/lockdown off` phá quyền gốc của kênh | Xoá overwrite về `null`, không set `true` |
