# Ticket, Kênh Thống Kê, Poll, Bảng Xếp Hạng Voice

Ngày: 2026-08-25
Trạng thái: DONE (2026-08-26)
Branch: main
Tiếp nối: `plans/260825-1558-quan-ly-tang-2-not-phan-con-lai/` (tầng 2, DONE)
Báo cáo: `plans/reports/cook-260826-0018-ticket-stats-poll-voicetop-report.md`

## Phạm Vi

Bốn thứ còn lại trong mục "Còn Có Thể Làm Thêm" của `docs/community-management.md`.
Khác ba đợt trước: đây **không** phải thay bot nào cụ thể — Carl-bot/Dyno/ProBot/VoiceMaster
đã bị phủ hết. Đây là những thứ server thường cần thêm.

| # | Tính năng | Thay bot nào | Bảng mới |
|---|---|---|---|
| 1 | Ticket / modmail | Ticket Tool, Carl-bot modmail | `Ticket`, `TicketConfig` |
| 2 | Kênh thống kê (member count, online, voice) | Statbot, ProBot counter | `StatsChannel` |
| 3 | `/poll` | Carl-bot poll, ProBot poll | **không** (dùng poll gốc của Discord) |
| 4 | Bảng xếp hạng thời gian voice | Statbot | `VoiceActivity` |

## Phases

| # | Phase | File | Trạng thái |
|---|---|---|---|
| 9 | Migration + ticket / modmail | [phase-09-ticket-modmail.md](phase-09-ticket-modmail.md) | DONE |
| 10 | Kênh thống kê tự cập nhật | [phase-10-kenh-thong-ke.md](phase-10-kenh-thong-ke.md) | DONE |
| 11 | `/poll` dùng poll gốc Discord | [phase-11-poll.md](phase-11-poll.md) | DONE |
| 12 | Thời gian voice + `/voicetop` | [phase-12-voice-time-leaderboard.md](phase-12-voice-time-leaderboard.md) | DONE |

Phase 9 chứa migration cho cả đợt.

## Hai Cái Bẫy Kỹ Thuật Của Đợt Này

Khác các đợt trước (bẫy chủ yếu về bảo mật), đợt này có hai bẫy về **giới hạn của Discord**:

1. **Đổi tên kênh chỉ được 2 lần mỗi 10 phút.** Đây là chỗ hầu hết bot thống kê tự làm bị
   hỏng: đặt nhịp 1 phút thì lần thứ ba trong 10 phút bị Discord chặn, và request bị treo
   trong hàng đợi rate-limit của discord.js — không phải lỗi ném ra, mà là **treo im lặng**,
   kéo theo mọi request khác của bot xếp hàng sau nó. Nhịp tối thiểu ở đây là **15 phút**,
   ghi cứng làm sàn trong config chứ không để ai đặt thấp hơn.

2. **Poll: dùng poll gốc của Discord, không tự dựng.** discord.js ≥ 14.16 có `poll` trong
   payload gửi tin. Tự dựng bằng nút thì phải tự lưu phiếu, tự chặn bỏ phiếu hai lần, tự
   ẩn kết quả tới khi đóng, tự hẹn giờ đóng — bốn thứ Discord đã làm sẵn và làm đúng hơn.
   Đổi lại: trần 10 lựa chọn và thời hạn tính theo giờ. Chấp nhận được.

## Bảo Mật

1. **Ticket là kênh riêng có dữ liệu cá nhân.** Chỉ người mở + role staff thấy được.
   `@everyone` bị gỡ `ViewChannel` ngay lúc tạo, không phải sau đó — tạo kênh public rồi
   mới khoá là một khoảng vài trăm ms cả server đọc được.
2. **Trần ticket mỗi người.** Không có trần thì một người bấm nút 50 lần là server có 50
   kênh và không ai dọn được bằng tay.
3. **Người mở ticket không được thêm người khác vào.** Chỉ staff mới `/ticket add`.
4. **Transcript khi đóng** — gửi vào kênh log, không gửi vào kênh công khai.
5. **Kênh thống kê là kênh voice bị khoá `Connect`.** Tên kênh là dữ liệu; không ai cần
   vào được nó.
6. **`/poll` không ping.** Poll gốc của Discord không mang mention, nhưng câu hỏi vẫn phải
   đi qua `parse: []` cho phần content.
7. **Thời gian voice không tính được bằng cách treo máy.** Bỏ kênh AFK của server và bỏ
   khoảng thời gian tự tắt tai nghe — nếu không thì bảng xếp hạng chỉ đo ai để máy chạy lâu nhất.

## Acceptance Criteria

- `/ticket setup` dựng panel; bấm nút → kênh riêng chỉ mình + staff thấy; `/ticket close`
  gửi transcript vào log rồi xoá kênh; mở quá trần → bị từ chối.
- `/statschannel setup kind:members` → kênh voice hiện số member, tự cập nhật mỗi 15 phút,
  không bao giờ gọi setName nhanh hơn thế. (Đặt tên là `statschannel` chứ không `stats` vì
  `/stats` đã tồn tại cho phần tổng quan server.)
- `/poll "câu hỏi" "A" "B" duration:24` → poll gốc của Discord, tự đóng sau 24h.
- Ngồi voice 10 phút → `/voicetop` hiện tên mình; tự tắt tai nghe thì không tính.
- `npm run build` + `npm test` pass sau mỗi phase.

## Rollback

Một migration, toàn bộ `CREATE TABLE`. Riêng ticket: revert khi đang có kênh ticket mở thì
phải xoá tay (bot sẽ không còn biết kênh nào là ticket).
