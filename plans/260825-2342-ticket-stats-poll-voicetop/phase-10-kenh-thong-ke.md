# Phase 10 — Kênh thống kê tự cập nhật

Trạng thái: DONE (2026-08-26)
Phụ thuộc: P9 (migration)

## Cái Bẫy Phải Biết Trước Khi Viết

**Discord chỉ cho đổi tên một kênh 2 lần mỗi 10 phút.** Vượt trần thì request không lỗi —
nó bị **treo trong hàng đợi rate-limit của discord.js** cho tới khi hết hạn, và mọi request
khác của bot xếp hàng sau nó. Nghĩa là một kênh thống kê đặt nhịp 1 phút có thể làm cả bot
đứng, và triệu chứng nhìn giống "bot lag" chứ không giống "cấu hình sai".

Nên: nhịp cập nhật **15 phút**, và `config.stats.minIntervalMs` là **sàn cứng** — hàm
scheduler tự nâng lên nếu ai đó đặt thấp hơn.

Thêm một lớp nữa: chỉ gọi `setName` khi **tên mới khác tên hiện tại**. Số member không đổi
trong 15 phút là chuyện thường, và một lần gọi API không cần thiết vẫn tiêu một lượt trong
trần 2/10 phút.

## Yêu Cầu

- `/stats setup <kind> [label]` — `ManageChannels`. Tạo kênh voice khoá `Connect`,
  đăng ký vào `StatsChannel`.
- `kind`: `members` (tổng) · `humans` · `bots` · `online` · `voice` (đang trong voice) ·
  `boosts`.
- `/stats remove <channel>` · `/stats list` · `/stats refresh` (cập nhật ngay, dùng khi vừa setup).
- Kênh voice chứ không phải text: tên kênh voice hiện ở sidebar và không sinh tin nhắn nào.
  Khoá `Connect` cho `@everyone` — không ai cần vào một cái nhãn.
- Kênh đã bị xoá tay → xoá row, không log lỗi mỗi 15 phút.
- `online` cần intent `GuildPresences` (bot **chưa có**) → nếu thiếu intent thì `/stats setup online`
  bị từ chối kèm giải thích, thay vì tạo một kênh luôn hiện 0.

## Files

Tạo: `src/systems/stats/stats-channel-manager.ts`, `src/commands/stats.ts`
Sửa: `src/config.ts` (`stats`), `src/events/ready.ts`, `scripts/self-check.js`

## Rủi Ro

| Rủi ro | Xử lý |
|---|---|
| Rate-limit đổi tên làm treo bot | Nhịp 15 phút + sàn cứng + chỉ gọi khi tên đổi |
| `memberCount` sai sau restart | Dùng `guild.memberCount` (Discord trả sẵn), không đếm cache |
| Kênh bị xoá tay | Xoá row lúc fetch trả null |
| `online` luôn bằng 0 | Từ chối `kind=online` khi thiếu intent `GuildPresences` |
