# Phase 09 — Ticket / modmail

Trạng thái: DONE (2026-08-26)

## Migration (cho cả đợt)

`prisma/migrations/20260825050000_ticket_stats_voice/migration.sql`

```prisma
model TicketConfig {
  guildId     String   @id
  categoryId  String?
  staffRoleId String?
  panelChannelId String?
  panelMessageId String?
  maxPerUser  Int      @default(2)
  updatedAt   DateTime @updatedAt
}

model Ticket {
  id        Int      @id @default(autoincrement())
  channelId String   @unique
  openerId  String
  topic     String
  claimedBy String?
  closedBy  String?
  closedAt  DateTime?
  createdAt DateTime @default(now())
  @@index([openerId, closedAt])
}

model StatsChannel {
  channelId String   @id
  kind      String   // members | humans | bots | online | voice | boosts
  template  String   @default("{label}: {value}")
  createdBy String
  createdAt DateTime @default(now())
}

model VoiceActivity {
  userId       String   @id
  totalSeconds Int      @default(0)
  weekKey      String
  weekSeconds  Int      @default(0)
  updatedAt    DateTime @updatedAt
  @@index([totalSeconds])
  @@index([weekKey, weekSeconds])
}
```

## Yêu Cầu

- `/ticket setup [category] [staffrole] [channel]` — `ManageGuild`. Dựng panel có nút
  `Mở ticket`, lưu config. Chạy lại thì **sửa** panel cũ, không đăng panel thứ hai.
- Bấm nút → modal hỏi chủ đề → tạo kênh text trong category, tên `ticket-<số>`.
- Quyền kênh đặt **ngay lúc create** (`permissionOverwrites` trong `channels.create`):
  `@everyone` mất `ViewChannel`; người mở + staff role + bot có `ViewChannel`,
  `SendMessages`, `ReadMessageHistory`, `AttachFiles`. Tạo kênh public rồi mới khoá là
  một khoảng vài trăm ms cả server đọc được nội dung.
- Trong kênh: embed chào + nút `Nhận xử lý` (staff) / `Đóng ticket`.
- `/ticket close [reason]` — người mở hoặc staff. Gửi transcript (file .txt) vào kênh log,
  rồi xoá kênh sau 5 giây.
- `/ticket add @user` / `/ticket remove @user` — **chỉ staff**. Người mở tự thêm người khác
  vào ticket của mình là đường lộ dữ liệu của chính họ cho người họ không định cho xem.
- `/ticket list` — ticket đang mở.
- Trần `maxPerUser` (mặc định 2) ticket đang mở mỗi người.

## Files

Tạo: `prisma/migrations/20260825050000_ticket_stats_voice/migration.sql`,
`src/systems/ticket/ticket-store.ts`, `src/systems/ticket/ticket-service.ts`,
`src/systems/ticket/ticket-transcript.ts`, `src/commands/ticket.ts`

Sửa: `prisma/schema.prisma`, `src/events/interactionCreate.ts`, `scripts/self-check.js`

## Rủi Ro

| Rủi ro | Xử lý |
|---|---|
| Spam nút mở ticket | Trần mỗi người + kiểm trước khi tạo kênh |
| Kênh ticket lộ nội dung lúc vừa tạo | Overwrite đặt trong lời gọi `channels.create`, không đặt sau |
| Đóng ticket mất nội dung | Transcript vào kênh log trước khi xoá kênh |
| Thiếu quyền `ManageChannels` | Báo rõ ở `/ticket setup` |
