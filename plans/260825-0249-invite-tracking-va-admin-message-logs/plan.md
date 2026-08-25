# Invite Tracking + Admin Message Logs — Đẩy Mạnh Quản Lý

Ngày: 2026-08-25
Trạng thái: DONE (đã cook cả 5 phase; build + self-check + 2 test suite pass)
Branch: main

## Mục Tiêu

1. **Invite system**: biết ai mời ai, bảng xếp hạng, hiện ở `/profile` + welcome, chống farm bằng cổng "pick role + acc ≥ 7 ngày + ở lại ≥ 24h".
2. **Thưởng invite**: 50 Scoin mỗi lượt verified, không giới hạn ngày. Không có role mốc, không thông báo công khai (Saly chốt).
3. **Giveaway ưu tiên theo invite**: nhiều invite = nhiều vé (không phải trúng luôn), 2 chế độ đếm (tổng từ trước tới giờ / tính từ lúc tạo giveaway).
4. **Log admin đầy đủ**: nội dung tin bị xoá/sửa, lịch sử sửa nhiều phiên bản, nút xem đoạn đã sửa (diff), cứu ảnh bị xoá.
5. **Công cụ quản lý mở rộng**: mod case (`/warn`, `/case`), `/inspect`, `/snipe`, log nickname/role/timeout, chống né mute, ghost-ping.

## Quyết Định Đã Chốt (Saly, 2026-08-25)

| Vấn đề | Chốt |
|---|---|
| Mirror tin nhắn | Có, giữ **14 ngày**, tất cả kênh text (tin đã xoá/sửa giữ 30 ngày) |
| Kênh log | Dùng chung `botLog` = `1532000288825671830` |
| Ảnh bị xoá | Không thêm kênh — cache bytes RAM rồi up trực tiếp vào embed log |
| Cổng tính invite | Pick role **+** acc ≥ 7 ngày **+** ở lại ≥ 24h |
| Thưởng invite | **50 Scoin/lượt, không cap**. Bỏ role mốc (tránh rối role). Không chúc mừng công khai |
| Ưu tiên giveaway | Có — vé theo lượt mời, mặc định +1 vé/lượt, trần +10 |
| `/warn` | Chỉ ghi hồ sơ, **không** tự timeout |
| Invite không rõ nguồn | Dồn về Saly `784728722459983874`, gắn `source=VANITY/UNKNOWN`, **không** sinh Scoin |

## Ràng Buộc Kỹ Thuật Quan Trọng

### Invite

- **Không có API lịch sử.** Chỉ có `guild.invites.fetch()` → mỗi invite: inviter + `uses`. Backfill = cộng `uses` theo inviter → ra **con số**, không ra danh sách người. Invite đã xoá/hết hạn thì uses mất vĩnh viễn.
  → Bảng xếp hạng tách 2 cột: `legacy` (backfill, đóng băng) + `verified` (đếm chính xác từ lúc bật).
  → Member cũ **không** hiện được "được ai mời".
- **`legacyUses` phải đóng băng ở lần scan đầu.** Scan lại sau khi hệ thống chạy sẽ đếm lại chính những join đã nằm trong `verified` → double count. Chỉ scan lại khi admin ép, và khi đó phải trừ số join đã ghi.
- Cần thêm `GatewayIntentBits.GuildInvites` (chưa có, `src/index.ts:18`) và bot phải có quyền **Manage Server** mới fetch được invites. Thiếu quyền → log lỗi rõ ràng, không fail im.
- Vanity URL: `fetchVanityData()` chỉ cho tổng uses, không cho người mời; server không đủ boost thì throw → catch và bỏ qua.
- Cơ chế nhận diện: cache `uses` mọi invite → lúc `guildMemberAdd` fetch lại, tìm code nào +1. **Trường hợp mù**: 2 người join cùng lúc, invite hết lượt rồi bị Discord xoá, join qua Discovery/lurker → `source=UNKNOWN` → dồn về Saly.
- Bot join (`member.user.bot`) không ghi InviteJoin, log riêng "ai add bot".

### Log

- `messageDelete` / `messageUpdate` **chỉ có nội dung cũ nếu tin còn trong cache RAM** (discord.js mặc định 200 tin/kênh, restart là mất) → bắt buộc mirror DB.
- URL CDN của ảnh chết ngay khi tin bị xoá → không thể "tải lúc bị xoá". Cache bytes ở `messageCreate` là cách duy nhất không cần kênh lưu trữ. Gap còn lại (>1h hoặc sau restart) là **đã biết và chấp nhận**; đường nâng cấp để ngỏ bằng config flag `logs.imageStrategy = 'ram' | 'archive'`.
- Dùng `Events.GuildAuditLogEntryCreate` (realtime) thay vì poll `fetchAuditLogs` để biết "mod nào xoá tin / kick ai" — không đua race như cách `antiRaidManager.ts:120` đang làm.
- Mirror **không** ghi tin của bot và không ghi kênh không phải guild text.
- Volume dự kiến: 3k tin/ngày × 14 ngày ≈ 42k dòng ≈ 10MB. Prune chạy 1 lần/giờ.

## Phases

| # | Phase | File | Phụ thuộc |
|---|---|---|---|
| 1 | Invite core: attribution, cổng verify, backfill, `/invites` | [phase-01-invite-core-attribution-va-verify.md](phase-01-invite-core-attribution-va-verify.md) | — |
| 2 | Invite rewards: Scoin, role mốc, chúc mừng | [phase-02-invite-rewards-scoin-va-role-moc.md](phase-02-invite-rewards-scoin-va-role-moc.md) | P1 |
| 3 | Giveaway ưu tiên tỷ lệ theo invite | [phase-03-giveaway-uu-tien-ty-le-theo-invite.md](phase-03-giveaway-uu-tien-ty-le-theo-invite.md) | P1 |
| 4 | Message log: mirror, diff, cứu ảnh | [phase-04-message-log-mirror-diff-cuu-anh.md](phase-04-message-log-mirror-diff-cuu-anh.md) | — |
| 5 | Quản lý mở rộng: mod case, inspect, snipe, log member/voice | [phase-05-quan-ly-mo-rong-mod-case-inspect-snipe.md](phase-05-quan-ly-mo-rong-mod-case-inspect-snipe.md) | P4 |

P4 độc lập với P1-P3 (khác bảng, khác event) → làm song song được. P5 cần mirror của P4.

## Acceptance Criteria

- `npm run build` (tsc) pass sau mỗi phase; `npm test` (self-check) pass.
- Người mới vào bằng link của A → welcome hiện "được A mời", A chưa được +1 ngay.
- Người đó pick role → lượt mời hiện trạng thái "đang chờ 24h"; sau 24h còn ở server → A +1 verified, +Scoin, DM cho A.
- Người đó rời trước 24h → A không được lượt nào; log hiện `LEFT`.
- Acc tạo < 7 ngày → ghi `REJECTED_YOUNG`, không tính, admin `/invites approve` ép được.
- Rejoin không tính lần 2 (`rejoinCount++`, credit giữ nguyên).
- Join qua vanity/không rõ → dồn về `784728722459983874`, `/invites` của Saly hiện tách riêng "vanity/unknown".
- `/invites top` xếp đúng theo `legacy + verified`; `/profile` hiện số mời.
- Giveaway `invite_bonus=since_start`: người mời 3 người trong thời gian giveaway có 4 vé (1 + 3), cap đúng, "Tỷ lệ của tôi" hiện đúng %.
- Xoá tin text 3 ngày trước (sau restart bot) → log vẫn có full nội dung từ mirror.
- Sửa tin 3 lần → log có 3 embed; nút "Xem lịch sử sửa" hiện đủ 4 phiên bản; nút "Xem đoạn đã sửa" tô đúng chỗ khác.
- Xoá tin có ảnh trong vòng 1h → embed log kèm lại ảnh.
- Xoá tin bởi mod → log ghi đúng "mod nào xoá"; tự xoá → ghi "tự xoá".
- Prune: dòng mirror > 14 ngày (chưa xoá/sửa) và > 30 ngày (đã xoá/sửa) bị dọn.

## Rollback

- P1-P3: revert commit. Migration chỉ `CREATE TABLE` + `ADD COLUMN` mặc định an toàn — bảng mới bỏ không cũng không ảnh hưởng luồng cũ. Intent `GuildInvites` gỡ được độc lập.
- P4: revert commit + `DROP TABLE "MessageMirror", "MessageVersion"`. Không có state ngoài DB (cache ảnh nằm RAM).
- P5: revert commit; `ModCase` giữ lại được vì chỉ đọc/ghi riêng.
- Điểm không lùi được: `legacyUses` sau khi đóng băng. Trước khi chạy backfill lần đầu phải `npm run db:backup`.

## Câu Hỏi Còn Mở

Không còn câu hỏi chặn. Những điểm đã quyết trong lúc cook và có thể đổi lại bằng một dòng config:

1. **Lượt vanity/không rõ nguồn không sinh Scoin** (`invite-rewards.ts`). Vẫn được ghi công cho Saly để không mất dấu, nhưng trả 50 Scoin cho mỗi người vào bằng link công khai là in tiền theo lượng người vào server chứ không theo công mời. Muốn trả thì bỏ điều kiện `source === 'INVITE'`.
2. **Vẫn DM người mời** khi lượt mời chín. Saly bỏ phần "chúc mừng" là chỉ bỏ thông báo công khai; nếu không có DM thì người mời chờ 24h mà không biết mình đã được tính hay chưa. Muốn tắt thì bỏ khối `user.send` trong `invite-rewards.ts`.
3. **Ảnh chỉ cứu được trong 1h và mất sau restart** — hệ quả trực tiếp của việc không dùng kênh lưu trữ. Đổi được bằng cách nâng `logs.image.ttlMs`, nhưng RAM là trần thật; muốn 100% thì phải mirror ảnh sang một kênh ngay lúc đăng.
4. **Chưa làm** (nhóm B của phase 5): log voice, cảnh báo acc nghi vấn kèm nút Kick/Ban lúc join, `/purge` có transcript, `/watch`, bản tin kiểm duyệt tuần.

## Yêu Cầu Vận Hành

- Bot cần 3 quyền: **Manage Server** (đọc invite), **View Audit Log** (biết mod nào xoá tin), **Moderate Members** (trả lại role mute). Thiếu quyền nào sẽ được báo vào botLog ngay lúc bot lên — xem `permission-preflight.ts`.
- Chạy `npx prisma migrate deploy` trước khi start bản mới. Nên `npm run db:backup` trước lần chạy đầu vì backfill lượt mời **đóng băng một lần**, không quét lại được.
- Role kỷ luật: bot đoán theo tên (`mute`, `muted`, `câm`, `cấm chat`, `jail`, `kỷ luật`). Nếu role mute của server tên khác thì điền id vào `config.moderation.stickyRoleIds`.
