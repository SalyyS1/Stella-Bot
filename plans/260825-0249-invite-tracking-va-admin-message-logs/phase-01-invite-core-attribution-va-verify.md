# Phase 01 — Invite Core: Attribution, Cổng Verify, Backfill

Trạng thái: DONE (build + self-check pass; chưa thử tay trên server thật)
Phụ thuộc: —

## Bối Cảnh

- `src/index.ts:18` — intents hiện thiếu `GuildInvites`.
- `src/events/guildMemberAdd.ts` — welcome embed + select menu `skillrole_toggle` (đây là "nhiệm vụ pick role" của Saly).
- `src/events/interactionCreate.ts:577` — nhánh xử lý `skillrole_toggle`, chỗ móc mốc "đã làm nhiệm vụ".
- `src/events/guildMemberRemove.ts` — chỗ đánh dấu rời server.
- `src/systems/skillRoleManager.ts:27` — mẫu bootstrap role + persist ID qua `ManagedChannel`, tái dùng ở P2.
- `src/events/ready.ts` — nơi đăng ký scheduler + bootstrap theo guild.

## Yêu Cầu

1. Biết ai mời ai cho mọi người vào **từ lúc bật**; không rõ nguồn thì dồn về `784728722459983874`.
2. Lượt mời chỉ tính khi: người được mời **pick role** + acc **≥ 7 ngày** + **ở lại ≥ 24h**.
3. Backfill số lượt mời quá khứ (đóng băng một lần) để bảng xếp hạng có dữ liệu ngày đầu.
4. `/invites`, `/top type=invites`, `/profile` hiện số mời.
5. Welcome hiện "được ai mời" + nhắc người mới pick role để người mời nhận lượt.

## Schema (prisma/schema.prisma + migration tay)

```prisma
// Ảnh chụp `uses` của mọi invite. Là mốc so sánh DUY NHẤT để biết ai mời:
// Discord không nói invite nào được dùng lúc member join, chỉ có thể diff.
model InviteCache {
  code      String    @id
  inviterId String?   // null = vanity / invite của bot / không rõ người tạo
  uses      Int       @default(0)
  maxUses   Int       @default(0)
  expiresAt DateTime?
  updatedAt DateTime  @updatedAt

  @@index([inviterId])
}

// Một lượt join = một dòng. invitedId là khoá chính nên rejoin KHÔNG tạo dòng
// mới — chống farm kiểu mời-kick-mời lại.
model InviteJoin {
  invitedId        String    @id
  inviterId        String
  code             String?
  source           String    // INVITE | VANITY | UNKNOWN
  status           String    @default("PENDING") // PENDING | VERIFIED | REJECTED_YOUNG | LEFT | REVOKED
  accountCreatedAt DateTime?
  joinedAt         DateTime  @default(now())
  rolePickedAt     DateTime? // mốc hoàn thành nhiệm vụ pick role ở welcome
  verifiedAt       DateTime?
  leftAt           DateTime?
  rejoinCount      Int       @default(0)
  note             String?   // lý do admin approve/revoke

  @@index([inviterId, status])
  @@index([status, joinedAt])
}

// Số lượt mời quá khứ, ĐÓNG BĂNG ở lần scan đầu. Không đóng băng thì lần scan
// sau đếm lại chính những join đã nằm ở InviteJoin.VERIFIED → cộng đôi.
model InviteBackfill {
  inviterId  String   @id
  legacyUses Int      @default(0)
  frozenAt   DateTime @default(now())
}
```

Migration: `prisma/migrations/20260825000000_invite_tracking/migration.sql` — chỉ `CREATE TABLE IF NOT EXISTS` + index, viết comment tiếng Việt giải thích vì sao `legacyUses` phải đóng băng (theo mẫu `20260823070000_music_playlist_v2`).

## Module Mới (`src/systems/invite/`, mỗi file < 200 LOC)

| File | Trách nhiệm |
|---|---|
| `invite-cache.ts` | `syncInviteCache(guild)`, `diffAndResolveCode(guild)` — fetch invites + vanity, upsert cache, trả code vừa tăng uses |
| `invite-attribution.ts` | `recordJoin(member)` — dựng `InviteJoin`, quyết `source`, fallback Saly, xử lý rejoin, chặn self-invite |
| `invite-verification.ts` | `markRolePicked(userId)`, `markLeft(userId)`, `runVerificationSweep(client)` + scheduler 5 phút |
| `invite-stats.ts` | `getInviteStats(userId)`, `getInviteLeaderboard(range, limit)`, `getInvitedList(userId)`, `getInviterOf(userId)` |
| `invite-backfill.ts` | `runInviteBackfillOnce(guild)` — chỉ chạy khi `InviteBackfill` rỗng, log kết quả ra botLog |

## Các Bước

1. **Intent + config**: thêm `GatewayIntentBits.GuildInvites` vào `src/index.ts`. Thêm block `config.invites`: `fallbackInviterId: '784728722459983874'`, `minAccountAgeDays: 7`, `stayHours: 24`, `sweepIntervalMs: 5*60_000`.
2. **Schema + migration** như trên; `npx prisma generate`.
3. **`invite-cache.ts`**: `syncInviteCache` fetch `guild.invites.fetch()` (catch `MissingPermissions` → `sendAdminLog` "bot thiếu Manage Server, invite tracking tắt" và trả `null`), `guild.fetchVanityData()` (catch → bỏ qua) lưu dưới code `__vanity__`. `diffAndResolveCode` so `uses` mới vs cache, ưu tiên code tăng đúng 1; nếu có ≥2 code tăng → trả `null` (mù, ghi UNKNOWN) thay vì đoán bừa.
4. **Events**: `src/events/inviteCreate.ts`, `src/events/inviteDelete.ts` → upsert/xoá dòng cache (event loader tự nạp theo file).
5. **`guildMemberAdd.ts`**:
   - Bỏ qua nếu `member.user.bot` (chỉ `sendAdminLog` "bot được add").
   - `const attribution = await recordJoin(member)` trước khi build embed.
   - Embed thêm dòng: `${emojis.contact} Được mời bởi <@X> · X đã mời **N** người` (nếu `source !== 'INVITE'` thì ghi `qua link công khai`).
   - Thêm dòng nhắc: `Chọn lĩnh vực bên dưới để <@X> được ghi nhận lượt mời nhé` — biến cổng chống bot thành lời mời gọi thay vì luật khô.
   - `sendAdminLog` thêm field `Invite`: code + source + trạng thái + tuổi acc.
6. **`recordJoin`**: acc < 7 ngày → `status='REJECTED_YOUNG'`; `inviterId === member.id` → dồn fallback (self-invite qua alt vẫn không chặn được hết, chỉ chặn ca hiển nhiên); đã có dòng cũ → `rejoinCount++`, cập nhật `leftAt=null`, **không** đổi credit đã VERIFIED.
7. **`interactionCreate.ts:577`**: sau khi toggle role thành công (`state === 'added'`), gọi `markRolePicked(interaction.user.id)`; reply thêm câu "Đã ghi nhận, người mời bạn sẽ nhận lượt sau 24h" nếu dòng InviteJoin đang PENDING.
8. **`guildMemberRemove.ts`**: `markLeft(member.id)` — PENDING → `LEFT`; VERIFIED → chỉ set `leftAt` (giữ credit, thống kê hiện riêng).
9. **`runVerificationSweep`**: quét `status='PENDING' AND rolePickedAt IS NOT NULL AND joinedAt <= now-24h`, kiểm tra member còn trong guild (`guild.members.fetch`), flip sang VERIFIED bằng `updateMany` có điều kiện (`count === 1` là khoá idempotent cho P2 trả thưởng). Member đã rời mà chưa bắt được event → `LEFT`.
10. **`ready.ts`**: `syncInviteCache(guild)` → `runInviteBackfillOnce(guild)` → `startInviteVerificationScheduler(client)`.
11. **`commands/invites.ts`**:
    - `/invites [user]`: embed tổng (`legacy + verified`), verified, đang chờ, bị loại (young/left), rank, "được ai mời", 5 người mời gần nhất. Nút `invite_list_<userId>_<page>` xem full danh sách, nút mở leaderboard.
    - `/invites top [range: all|month|week]`.
    - `/invites admin approve|revoke|rescan|audit` (Administrator): `approve` ép VERIFIED cho ca `REJECTED_YOUNG`; `revoke` set `REVOKED` + ghi `note`; `rescan` chỉ đồng bộ cache (KHÔNG chạm `legacyUses`); `audit` list nghi vấn (cùng inviter, ≥3 acc < 7 ngày trong 24h; hoặc join-leave < 10 phút).
12. **`commands/top.ts`**: thêm choice `{ name: 'Lượt mời', value: 'invites' }` → nhánh gọi `getInviteLeaderboard`, hiện `legacy` tách `verified` để không ai tưởng số cũ là đếm chính xác.
13. **`commands/profile.ts`**: thêm vào field "Điểm Stella" một dòng `${emojis.contact} Mời: **N** người` (không thêm field mới để embed khỏi phình).

## Kiểm Chứng

- `npm run build` pass.
- Thêm assertion vào `scripts/self-check.js`: `invite-attribution.ts` có chuỗi `REJECTED_YOUNG` + `fallbackInviterId`; `guildMemberAdd.ts` có `recordJoin`; `interactionCreate.ts` có `markRolePicked`.
- Thử tay trên server: tạo link riêng → acc phụ vào → welcome đúng người mời → pick role → `/invites` hiện đang chờ → chỉnh tay `joinedAt` lùi 25h trong DB → chờ sweep → VERIFIED.
- Test vanity: vào bằng link vanity (nếu server có) → `/invites @Saly` hiện mục vanity tách riêng.

## Rủi Ro

| Rủi ro | Xử lý |
|---|---|
| Bot thiếu quyền Manage Server | `syncInviteCache` trả `null` + log rõ; welcome vẫn chạy, chỉ không có dòng người mời |
| 2 người join cùng giây | Ghi `UNKNOWN` → dồn Saly, KHÔNG đoán bừa gán oan cho ai |
| Race giữa sweep và member rời | Flip trạng thái bằng `updateMany` điều kiện; `count === 1` mới trả thưởng (P2) |
| Backfill chạy lại → cộng đôi | Chỉ chạy khi bảng rỗng; `/invites admin rescan` cố ý không chạm `legacyUses` |
| Người mời rời server | Vẫn giữ dòng, `/invites` hiện `(đã rời)`; leaderboard vẫn tính (dữ liệu lịch sử) |
