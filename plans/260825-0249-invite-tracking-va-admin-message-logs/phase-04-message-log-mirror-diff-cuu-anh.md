# Phase 04 — Message Log: Mirror, Lịch Sử Sửa, Diff, Cứu Ảnh

Trạng thái: DONE (`tests/text-diff.test.ts` — 8 test pass)
Phụ thuộc: —

> Ghi chú khi cook: `/purge` (nhóm B) chưa làm, nhưng log bulk-delete đã chạy cho MỌI
> lượt xoá hàng loạt kể cả purge bằng bot khác hoặc bằng tay, kèm file transcript.

## Bối Cảnh

- `src/index.ts:27` — đã có `Partials.Message` nên `messageDelete`/`messageUpdate` vẫn bắn cho tin ngoài cache (nhưng nội dung `null` → lý do phải mirror).
- `src/utils/adminLog.ts:11` — `sendAdminLog` chỉ nhận embed đơn giản, **không** nhận `files`/`components` → cần hàm gửi riêng cho log tin nhắn.
- `src/events/messageCreate.ts` — đã dài (413 LOC) và nhiều nhánh; mirror phải là **1 dòng gọi ở đầu**, logic nằm ở module riêng.
- `src/systems/antiRaidManager.ts:120` — đang poll `fetchAuditLogs`; phase này dùng `Events.GuildAuditLogEntryCreate` realtime, không sửa anti-raid.

## Yêu Cầu

1. Tin bị xoá → log hiện **nội dung đầy đủ** kể cả tin cũ 3 ngày và kể cả sau restart bot.
2. Tin bị sửa → log hiện trước/sau, nút xem **đoạn đã sửa** (diff), nút xem **toàn bộ lịch sử sửa**.
3. Ảnh bị xoá/sửa → cứu được ảnh, up trực tiếp vào embed log.
4. Xoá hàng loạt (purge) → 1 log tổng + file transcript.
5. Biết **ai** xoá: tự xoá hay mod xoá.
6. Log đổ vào `config.channels.botLog` (`1532000288825671830`).

## Schema

```prisma
// Bản sao tin nhắn, giữ 14 ngày. Discord chỉ trả nội dung tin cũ nếu tin còn
// trong cache RAM (mặc định 200 tin/kênh, mất sạch khi restart) — nên nếu không
// có bảng này thì log "tin bị xoá" chỉ ra được cái vỏ: ai, kênh nào, lúc nào,
// còn nội dung — thứ duy nhất cần để phân xử — thì mất.
model MessageMirror {
  messageId    String    @id
  channelId    String
  authorId     String
  content      String                    // nội dung HIỆN TẠI (cập nhật mỗi lần sửa)
  attachments  String?                   // JSON [{name,url,size,contentType}]
  stickerNames String?
  replyToId    String?
  createdAt    DateTime                  // thời điểm gửi thật (không phải lúc mirror)
  editedAt     DateTime?
  editCount    Int       @default(0)
  deletedAt    DateTime?
  deletedBy    String?                   // từ audit log; null = tự xoá
  mirroredAt   DateTime  @default(now())

  versions MessageVersion[]

  @@index([authorId, createdAt])
  @@index([channelId, createdAt])
  @@index([mirroredAt])                  // prune quét theo cột này
  @@index([deletedAt])
}

// Từng phiên bản nội dung. version 1 = bản gốc, chèn lúc sửa lần đầu.
model MessageVersion {
  id        Int      @id @default(autoincrement())
  messageId String
  version   Int
  content   String
  changedAt DateTime @default(now())

  message MessageMirror @relation(fields: [messageId], references: [messageId], onDelete: Cascade)

  @@unique([messageId, version])
}
```

Prune 2 tầng (chạy 1 lần/giờ):
- dòng **bình thường**: `mirroredAt < now-14d` → xoá.
- dòng **đã xoá hoặc đã sửa**: giữ tới `now-30d` — đây đúng là loại dòng admin cần soi lại.

## Module (`src/systems/logs/`, mỗi file < 200 LOC)

| File | Trách nhiệm |
|---|---|
| `message-mirror.ts` | `mirrorMessage(msg)`, `applyEdit(msg)`, `markDeleted(id, byId)`, `getMirror(id)`, `pruneMirror()` |
| `message-image-cache.ts` | LRU bytes ảnh: `cacheAttachments(msg)`, `takeCachedFiles(messageId)` |
| `message-log-embeds.ts` | Dựng embed + components cho delete / edit / bulk-delete |
| `message-log-sender.ts` | Gửi vào `botLog` kèm `files` + `components` (thứ `sendAdminLog` không làm được) |
| `audit-actor-resolver.ts` | Nhớ ngắn hạn actor từ `GuildAuditLogEntryCreate` để trả lời "ai xoá" |

Thêm `src/utils/text-diff.ts` — diff theo từ (LCS), không thêm dependency.

## Các Bước

1. Schema + migration `20260825020000_message_mirror`.
2. **config**: block `logs`: `enabled: true`, `channelKey: 'botLog'`, `retainDays: 14`, `retainFlaggedDays: 30`, `imageStrategy: 'ram'`, `imageChannelIds: [config.channels.chat]`, `imageMaxBytes: 8*1024*1024`, `imageCacheTotalBytes: 64*1024*1024`, `imageCacheTtlMs: 60*60_000`, `ignoreChannelIds: []`.
3. **`message-mirror.ts`**: bỏ qua bot, DM, tin không có gì (không content + không attachment). `mirrorMessage` dùng `upsert` (tin edit trước khi mirror kịp thì vẫn có dòng). Content cắt 4000 ký tự (giới hạn embed) — ghi chú rõ trong code là cắt để log được, không phải để tiết kiệm.
4. **`message-image-cache.ts`**: chỉ nhận ảnh (`contentType?.startsWith('image/')`) ở kênh trong `imageChannelIds`, `size <= imageMaxBytes`. `fetch(url)` → `Buffer`. Map theo `messageId`, tổng bytes vượt trần → evict cũ nhất (LRU); TTL 1h dọn bằng `setInterval` 5 phút. Ghi comment: **đây là lý do ảnh xoá sau 1h hoặc sau restart chỉ còn tên file** — trade-off đã chốt để không cần kênh lưu trữ.
5. **`messageCreate.ts`**: thêm 2 dòng ở đầu (sau guard bot): `void mirrorMessage(message)` và `void cacheAttachments(message)` — `void` + catch nội bộ để log không bao giờ chặn luồng chat/XP/AI.
6. **`src/events/messageUpdate.ts`** (mới):
   - Bỏ qua bot / content không đổi (Discord bắn `messageUpdate` cả khi chỉ có embed preview load xong — không lọc là log rác).
   - Lấy `before` theo thứ tự: mirror DB → `oldMessage.content` → `null`.
   - `applyEdit`: nếu chưa có `MessageVersion` nào thì chèn version 1 = `before`, rồi chèn version tiếp = nội dung mới; `editCount++`.
   - Log embed: author, kênh, link tới tin, **Trước** / **Sau** (mỗi cái ≤ 1000 ký tự), lần sửa thứ N. Components: `msglog_diff_<messageId>`, `msglog_history_<messageId>`.
   - Nếu tin có ảnh và ảnh **bị bỏ khỏi** tin (sửa xoá ảnh) → attach ảnh từ cache.
7. **`src/events/messageDelete.ts`** (mới):
   - Lấy nội dung từ mirror (hoặc cache RAM của discord.js nếu mirror trượt).
   - Chờ tối đa ~1.5s cho `audit-actor-resolver` trả actor (audit entry thường tới sau event) → hiện "Xoá bởi: <@mod>" hoặc "Tự xoá".
   - `markDeleted`. Attach ảnh từ cache; nếu không còn → field "Ảnh: `tên.png` (đã hết hạn, không cứu được)".
   - Components: nút `msglog_history_` nếu `editCount > 0`, nút link "Xem ngữ cảnh" tới kênh gốc.
8. **`src/events/messageDeleteBulk.ts`** (mới): 1 embed tổng (số tin, kênh, ai purge từ audit log, top tác giả bị xoá) + attach `transcript-<channel>-<time>.txt` dựng từ mirror. Không spam N embed.
9. **`src/events/guildAuditLogEntryCreate.ts`** (mới): với `MessageDelete` / `MessageBulkDelete` → nhớ `{ channelId, targetId, executorId, at }` trong Map TTL 10s cho resolver. (P5 dùng lại file này cho mod case.)
10. **`text-diff.ts`**: `diffWords(before, after)` → mảng `{ type: 'same'|'add'|'del', text }`; `renderDiffBlock()` → khối ```diff với `+`/`-` (Discord tô màu sẵn cho code block `diff`). Cắt an toàn 1800 ký tự/khối.
11. **`interactionCreate.ts`**: 2 nhánh mới, **chỉ Administrator** (`interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)`):
    - `msglog_diff_<id>` → ephemeral: diff giữa 2 phiên bản mới nhất.
    - `msglog_history_<id>` → ephemeral: liệt kê mọi phiên bản kèm `<t:...:T>`; >5 phiên bản thì gửi file `.txt`.
12. **`ready.ts`**: `startMessageMirrorPruneScheduler()` — nhịp 1h, chạy ngay 1 lần lúc boot.

## Kiểm Chứng

- `npm run build` pass. Self-check assertion: `messageCreate.ts` có `mirrorMessage`; `messageUpdate.ts` có `msglog_diff_`; `message-mirror.ts` có cả `retainDays` và `retainFlaggedDays`.
- `tests/text-diff.test.ts`: thêm từ giữa câu, xoá từ, đổi toàn bộ, chuỗi rỗng, chuỗi 5000 ký tự (không throw, có cắt).
- Thử tay: gửi tin → **restart bot** → xoá tin → log vẫn có nội dung (chứng minh mirror hoạt động, không phải nhờ cache RAM).
- Sửa 3 lần → 3 embed; nút lịch sử ra 4 phiên bản; nút diff tô đúng từ đổi.
- Gửi ảnh → xoá trong vòng 1h → embed log có lại ảnh. Xoá sau khi restart → hiện "đã hết hạn".
- Mod xoá tin người khác → "Xoá bởi @mod". Tự xoá → "Tự xoá".
- `/purge`-style bulk delete → 1 embed + file transcript đúng số dòng.

## Rủi Ro

| Rủi ro | Xử lý |
|---|---|
| botLog bị ngập vì mỗi lần sửa 1 embed | Đã chốt dùng chung botLog; nếu ngập thì đổi `logs.channelKey` sang kênh mới, 1 dòng config |
| RAM ảnh phình trên shared hosting | Trần tổng 64MB + TTL 1h + LRU; chỉ 1 kênh chat chính |
| Mirror làm chậm messageCreate | `void` + catch nội bộ, không `await` trong luồng chính |
| DB phình ngoài dự kiến | Prune 2 tầng theo `mirroredAt` (có index); theo dõi `db:verify` sau 1 tuần |
| Log lộ tin nhắn riêng tư ra kênh admin | Chỉ mirror kênh guild text (không DM); `ignoreChannelIds` để loại kênh riêng tư nếu cần |
| `messageUpdate` bắn khi embed load | Lọc `content` không đổi trước khi log |
