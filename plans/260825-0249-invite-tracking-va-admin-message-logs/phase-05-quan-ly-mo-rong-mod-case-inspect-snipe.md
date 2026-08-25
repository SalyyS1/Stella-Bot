# Phase 05 — Quản Lý Mở Rộng: Mod Case, Inspect, Snipe, Log Member

Trạng thái: DONE nhóm A + ghost-ping. Nhóm B còn lại chưa làm (xem cuối file).
Phụ thuộc: P4 (cần mirror tin nhắn)

## Chốt Của Saly

- `/warn` **chỉ ghi hồ sơ**, không tự timeout khi đủ N warn. Bot ghi nhận, mod quyết.

## Đã Làm

| Hạng mục | File |
|---|---|
| A1 Mod case + auto-case từ audit log | `systems/moderation/mod-case-manager.ts`, `events/guildAuditLogEntryCreate.ts`, `commands/warn.ts`, `commands/case.ts` |
| A2 `/inspect` | `commands/inspect.ts` + nút `inspect_recent_*` trong `interactionCreate.ts` |
| A3 `/snipe` (xoá + sửa) | `commands/snipe.ts` |
| A4 Chống né mute | `systems/moderation/sticky-role-manager.ts` + hook ở `guildMemberAdd/Remove` |
| A5 Log member (nickname/role/timeout) | `events/guildMemberUpdate.ts` |
| B2 Ghost-ping | trong `events/messageDelete.ts` |
| Kiểm quyền lúc bot lên | `systems/moderation/permission-preflight.ts` |

Số warn hiện trong `/profile` **chỉ khi người xem có quyền Moderate Members** — hồ sơ kỷ luật của một người không phải thứ để cả server tra bằng lệnh công khai.

## Bối Cảnh

- `src/systems/antiRaidManager.ts` — đã có guard `everyone` mention, channel/role create-delete, ban, member remove. Phase này **không** sửa anti-raid, chỉ thêm lớp ghi nhận + tra cứu.
- `src/events/guildBanAdd.ts` đã có; chưa có `guildMemberUpdate`, `voiceStateUpdate`.
- `src/events/guildAuditLogEntryCreate.ts` (tạo ở P4) là chỗ bắt mọi hành động mod realtime → tái dùng.
- `src/commands/profile.ts` — chỗ gắn thêm số warn khi người xem là admin.

## Nhóm A — Nên làm (xương sống quản lý)

### A1. Mod case system

```prisma
// Hồ sơ kỷ luật. Mọi ban/kick/timeout do mod làm được ghi TỰ ĐỘNG từ audit log,
// không phụ thuộc mod có dùng lệnh của bot hay không — nếu chỉ ghi khi dùng lệnh
// thì hồ sơ sẽ trống đúng vào những ca xử lý gấp bằng tay.
model ModCase {
  id         Int      @id @default(autoincrement())
  targetId   String
  actorId    String
  kind       String   // WARN | NOTE | TIMEOUT | KICK | BAN | UNBAN | MUTE_EVADE
  reason     String?
  evidence   String?  // link tin nhắn / message id
  expiresAt  DateTime?
  active     Boolean  @default(true)
  createdAt  DateTime @default(now())

  @@index([targetId, createdAt])
  @@index([actorId])
  @@index([kind])
}
```

- `/warn @user <lý do> [bằng chứng]` → tạo case, DM người bị warn, log botLog.
- `/note @user <ghi chú>` → case nội bộ, **không** DM (dùng để ghi "thằng này hay cà khịa" mà chưa cần xử).
- `/case list @user` → toàn bộ hồ sơ; `/case delete <id>` (Administrator).
- Auto-case từ `guildAuditLogEntryCreate`: `MemberBanAdd`, `MemberKick`, `MemberUpdate` (timeout) → ghi case với `actorId` là mod thật.
- `/profile` khi người xem có quyền mod: thêm dòng `⚠️ N warn · M case`.
- Đề xuất ngưỡng: 3 warn còn hiệu lực → tự timeout 24h. **Cần Saly chốt** có bật auto hay chỉ cảnh báo mod.

### A2. `/inspect @user` — một embed đủ để xử một ca

Gom sẵn: ngày tạo acc + tuổi acc, ngày join, **được ai mời**, đã mời bao nhiêu (P1), level/XP/Scoin, tin nhắn 24h & 7 ngày (từ mirror), số tin **bị xoá** & **đã sửa** 7 ngày (mirror), số warn/case, role hiện có, mốc cờ nghi vấn (acc mới + không avatar + join < 24h). Nút: `Xem 10 tin gần nhất`, `Xem hồ sơ kỷ luật`, `Warn`.

Đây là thứ thay thế việc mở 5 kênh log để ghép chuyện.

### A3. `/snipe` + `/editsnipe` (chỉ mod)

Miễn phí sau P4: đọc mirror `deletedAt`/`editCount` mới nhất của kênh. Giới hạn 15 phút gần nhất để không thành công cụ đào tin cũ.

### A4. Chống né mute (sticky roles)

```prisma
model StickyRole {
  userId    String   @id
  roleIds   String            // CSV role lúc rời
  savedAt   DateTime @default(now())
}
```

`guildMemberRemove` lưu role; `guildMemberAdd` khôi phục role **kỷ luật** (mute/timeout-role) và tuỳ chọn role thường. Lý do: rời-vào-lại là cách né mute cổ điển nhất, và nó cũng làm sạch luôn `InviteJoin` nếu không có P1 chặn rejoin.

### A5. Log thay đổi member (`guildMemberUpdate`)

Nickname đổi (bắt mạo danh), role thêm/gỡ (ai cấp quyền cho ai — quan trọng nhất), avatar server, timeout bắt đầu/hết. Gộp nhiều thay đổi cùng lúc thành 1 embed.

## Nhóm B — Nên làm nếu còn sức

### B1. Log voice (`voiceStateUpdate`)
Join/leave/move/self-mute + thời lượng ở kênh. Vừa để soi raid, vừa là dữ liệu cho "top thời gian voice" sau này.

### B2. Ghost-ping detector
Tin có mention người/role bị xoá trong 60s → embed log riêng màu đỏ "@A đã ping @B rồi xoá" kèm nội dung. Đây là kiểu quấy rối không để lại dấu vết nào khác.

### B3. Cảnh báo acc nghi vấn lúc join
Acc < 7 ngày hoặc không avatar → embed ở botLog kèm nút `Kick` / `Ban` / `Bỏ qua` cho mod bấm ngay. Ăn khớp với `REJECTED_YOUNG` của P1 (cùng ngưỡng 7 ngày).

### B4. `/purge [số] [@user] [chứa chữ]`
Xoá + tự đăng transcript vào botLog (dùng bulk-delete log của P4). An toàn hơn purge tay vì luôn còn bản ghi.

### B5. Bản tin kiểm duyệt tuần
Ghép vào `src/systems/report/` đang có: số tin xoá/sửa, top người bị xoá, warn mới, invite mới + tỷ lệ giữ người 7 ngày, số acc nghi vấn. Không cần scheduler mới.

### B6. `/watch @user [ngày]`
Bật theo dõi: mọi tin của người đó được copy sang botLog trong N ngày. Dùng cho ca đang nghi mà chưa đủ bằng chứng, tự tắt khi hết hạn.

## Không nên làm (ghi lại để khỏi bàn lại)

- **Lưu ảnh mọi kênh vĩnh viễn**: băng thông + dung lượng không xứng giá trị; đã chọn cache RAM 1h ở P4.
- **Log mọi tin nhắn ra kênh log**: kênh log sẽ thành bản sao của kênh chat, không ai đọc nổi. Mirror DB + `/snipe`/`/inspect` giải đúng nhu cầu đó.
- **Tự động ban theo AI đọc nội dung**: sai một ca là mất member thật; giữ người quyết định là mod.

## Thứ Tự Đề Xuất

1. A1 (mod case) — nền cho mọi thứ khác. ✅
2. A2 (`/inspect`) — thu lợi nhiều nhất từ mirror của P4. ✅
3. A4 (chống né mute) — bịt lỗ hổng thật đang mở. ✅
4. A5 (log member) + A3 (snipe). ✅
5. Nhóm B: chỉ B2 (ghost-ping) đã làm. **Chưa làm**: B1 log voice, B3 cảnh báo acc nghi vấn kèm nút Kick/Ban, B4 `/purge` có transcript, B5 bản tin kiểm duyệt tuần, B6 `/watch`.

## Kiểm Chứng

- `npm run build` pass; self-check assertion cho `ModCase` + `/inspect`.
- Thử tay: mod ban tay bằng UI Discord → case tự sinh với đúng `actorId`.
- Mute acc thử → acc rời → vào lại → role mute được khôi phục.
- `/inspect` trên acc thử hiện đúng số tin đã xoá/sửa 7 ngày.

## Rủi Ro

| Rủi ro | Xử lý |
|---|---|
| Auto-timeout theo warn xử oan | Mặc định TẮT, chờ Saly chốt; luôn DM kèm lý do + cách khiếu nại |
| Sticky role khôi phục cả role admin bị gỡ có chủ đích | Chỉ khôi phục role trong danh sách `logs.stickyRoleIds` (mặc định chỉ role kỷ luật) |
| `/watch` bị lạm dụng thành theo dõi member vô cớ | Administrator only, luôn ghi case `NOTE` khi bật để có dấu vết ai bật |
| Log voice quá ồn | Gộp theo phiên (join+leave = 1 dòng khi rời), tuỳ chọn tắt bằng config |
