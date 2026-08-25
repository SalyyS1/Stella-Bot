# Cook Report — Ticket, Kênh Thống Kê, Poll, Xếp Hạng Voice

Ngày: 2026-08-26
Plan: `plans/260825-2342-ticket-stats-poll-voicetop/`
Phases: 9–12, tất cả DONE
Branch: main (chưa commit)

## Kết Quả Kiểm Tra

| Lệnh | Kết quả |
|---|---|
| `npm run build` | pass (prisma generate + tsc, không lỗi) |
| `npm test` (self-check) | pass — **163 assertions** (thêm 6 cho đợt này) |
| `npm run test:automod` | 12/12 pass |
| `npm run test:diff` | 8/8 pass |
| `npm run test:giveaway` | 6/6 pass |

## Đã Làm

### Phase 9 — Ticket / Modmail

Bảng mới: `TicketConfig`, `Ticket`. Migration `20260825050000_ticket_stats_voice`.

- `src/systems/ticket/ticket-store.ts` — truy vấn DB thuần, gồm `reconcileTickets` đóng hồ
  sơ của kênh đã bị xoá tay.
- `src/systems/ticket/ticket-transcript.ts` — `.txt` phân trang 100 tin/lượt, trần 500.
- `src/systems/ticket/ticket-service.ts` — mở/đóng/panel.
- `src/systems/ticket/ticket-interactions.ts` — 4 customId, không nhồi channelId vào
  customId vì kênh chứa nút *chính là* ticket.
- `src/commands/ticket.ts` — setup / close / add / remove / list / status.

### Phase 10 — Kênh Thống Kê

Bảng mới: `StatsChannel`. `config.stats = { updateIntervalMs: 15m, minIntervalMs: 10m }`.

- `src/systems/stats/stats-channel-manager.ts` — 6 loại, scheduler, dọn dòng chết.
- `src/commands/statschannel.ts` — setup / remove / list / refresh.

### Phase 11 — Poll

- `src/commands/poll.ts` — payload `poll` gốc của Discord. Không bảng mới, không scheduler.

### Phase 12 — Thời Gian Voice

Bảng mới: `VoiceActivity`.

- `src/systems/stats/voice-activity-manager.ts`
- `src/commands/voicetop.ts`
- `src/events/voiceStateUpdate.ts` — nay là chuỗi 3 handler: phòng voice tạm → log → đếm giờ.
- `src/commands/profile.ts` — thêm dòng 🔊 Voice.

### Nối dây

- `src/events/interactionCreate.ts` — delegation `ticket_` (button + modal) đặt **trước**
  router chính.
- `src/events/ready.ts` — `startStatsScheduler(client)`.
- `docs/community-management.md` — mục "Tầng 3", quyền bot bổ sung, danh sách ý tưởng mới.

## Quyết Định Đáng Ghi Lại

1. **Quyền kênh ticket đặt trong `channels.create`, không đặt sau.** Tạo kênh public rồi mới
   gỡ `ViewChannel` để lại vài trăm ms cả server đọc được — mà ticket là chỗ người ta kể thứ
   họ chọn không kể công khai. Ghi DB lỗi thì xoá luôn kênh: thà không có ticket hơn là có
   kênh mồ côi mà `/ticket close` không nhận ra.

2. **`/ticket add|remove` là staff-only.** Cho người mở ticket tự thêm người khác nghĩa là
   cho họ tự làm lộ hồ sơ của chính họ — và về sau khó phân biệt "họ tự đồng ý" với "họ bị
   dụ bấm".

3. **Sàn 10 phút cho việc đổi tên kênh thống kê.** Trần Discord là 2 lần/10 phút và vượt
   trần thì request **treo im lặng trong hàng đợi rate-limit của discord.js**, không ném lỗi
   — kéo theo mọi request khác của bot xếp hàng sau. Đây là chỗ hầu hết bot thống kê tự viết
   bị hỏng. Thêm một tầng nữa: số không đổi thì không gọi `setName` chút nào.

4. **Đặt tên `/statschannel` chứ không `/stats`.** `/stats` đã tồn tại cho phần tổng quan
   server và là hai việc khác nhau; gộp lại thì một lệnh phục vụ hai đối tượng khác nhau.

5. **Poll gốc của Discord.** Tự dựng bằng nút phải tự lưu phiếu, tự chặn bỏ phiếu hai lần,
   tự ẩn kết quả, tự hẹn giờ đóng — bốn thứ Discord làm sẵn và làm đúng hơn, kể cả khi bot
   đang tắt. Trả giá: trần 10 lựa chọn, thời hạn tính theo giờ.

6. **Giờ voice bỏ kênh AFK và khoảng tự tắt tai nghe.** Không bỏ thì bảng xếp hạng đo ai để
   máy chạy lâu nhất, không đo ai tham gia nhiều nhất. Cố ý **không** bỏ "ngồi một mình":
   ngồi chờ bạn vào vẫn là dùng server, và tính "có ai khác trong kênh" cho từng giây đòi
   đánh giá lại mỗi lượt người khác vào/ra — phức tạp hơn nhiều so với giá trị nó thêm.

7. **Phiên voice giữ trong RAM, reset tuần lúc ghi.** Restart giữa phiên là mất phiên đó;
   đổi lại không phải ghi DB mỗi phút cho từng người đang trong voice. `weekSeconds` reset
   bằng cách so `weekKey` lúc ghi, nên không cần scheduler quét cả bảng lúc nửa đêm Chủ nhật.

## 6 Assertion Mới Trong `scripts/self-check.js`

- quyền kênh ticket phải nằm trong lời gọi create
- transcript phải chạy trước khi xoá kênh
- `/ticket add|remove` staff-only
- kênh thống kê phải có sàn nhịp + bỏ qua tên không đổi
- `/poll` phải dùng payload poll gốc
- giờ voice phải loại kênh AFK và `selfDeaf`

## Việc Còn Lại Trước Khi Chạy Thật

1. `npx prisma migrate deploy`. **6 folder migration đang untracked trong git**, cần kiểm
   xem cái nào đã lên DB thật (tôi không kiểm được trạng thái `_prisma_migrations` từ đây):
   `20260825000000_invite_tracking`, `20260825010000_giveaway_invite_weight`,
   `20260825020000_message_log_and_moderation`, `20260825030000_community_management_suite`,
   `20260825040000_management_tier2`, `20260825050000_ticket_stats_voice`.
   Cả 6 đều idempotent (`CREATE TABLE IF NOT EXISTS` + `DO $ … EXCEPTION WHEN
   duplicate_object`) nên chạy lại không hỏng gì.
2. Deploy slash command để Discord thấy lệnh mới (`ticket`, `statschannel`, `poll`,
   `voicetop`, và các lệnh tầng 2).
3. Chưa commit gì. Toàn bộ 3 đợt (7 hệ thống lõi + tầng 2 + tầng 3) còn nằm ở working tree.
4. `/statschannel setup kind:online` sẽ tự từ chối tới khi bật intent `GuildPresences` ở cả
   Developer Portal và `src/index.ts`.

## Chưa Kiểm Được

Toàn bộ đợt này **chỉ được kiểm bằng typecheck + assertion trên source**, chưa chạy trên
Discord thật. Bốn thứ chỉ runtime mới lộ:

- Ticket: category đầy 50 kênh → `channels.create` lỗi (đã có nhánh xoá kênh, chưa chạy thử).
- Kênh thống kê: hành vi treo hàng đợi khi vượt trần rename — mã đã tránh, nhưng chưa quan sát.
- Poll: version discord.js trong `node_modules` phải ≥ 14.16 để có field `poll`.
- Giờ voice: phiên dài qua mốc đổi tuần.

## Câu Hỏi Chưa Trả Lời

1. Có commit cả 3 đợt thành một commit lớn, hay tách 3 commit theo đợt? (Khuyến nghị: tách,
   vì mỗi đợt có migration riêng và lùi từng đợt được.)
2. Kênh log của ticket transcript hiện dùng kênh log chung. Có cần kênh riêng chỉ staff đọc?
3. `/voicetop` có nên tính vào phần thưởng tuần (`weekly-reward-manager`) như tin nhắn không,
   hay để riêng làm số liệu xem cho vui?
