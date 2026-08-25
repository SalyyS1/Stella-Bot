# Phase 11 — `/poll` dùng poll gốc của Discord

Trạng thái: DONE (2026-08-26)

## Vì Sao Không Tự Dựng Bằng Nút

discord.js ≥ 14.16 hỗ trợ `poll` trong payload gửi tin. Tự dựng bằng nút thì phải tự làm
bốn thứ Discord đã làm sẵn và làm đúng hơn:

- lưu phiếu của từng người (một bảng + một index)
- chặn bỏ phiếu hai lần (race khi bấm dồn dập)
- ẩn kết quả tới lúc đóng (nếu hiện ngay thì phiếu sau bị phiếu trước dẫn dắt)
- hẹn giờ đóng (một scheduler nữa, phải sống qua restart)

Đổi lại hai giới hạn: **tối đa 10 lựa chọn** và **thời hạn tính theo giờ** (1–768h = 32 ngày).
Cả hai đều chấp nhận được cho một cái poll cộng đồng — nên đây là chỗ không đáng tự viết.

Hệ quả: **không có bảng nào cho phase này.**

## Yêu Cầu

- `/poll question:<...> options:<A | B | C> [duration] [multi] [channel]`
- `options` là một chuỗi ngăn bởi `|` — nhập 10 option bằng 10 tham số slash sẽ chiếm gần
  hết trần 25 option của một lệnh.
- `duration`: số giờ, mặc định 24, trần 768 (giới hạn Discord).
- `multi`: cho chọn nhiều đáp án.
- Quyền: `ManageMessages` — poll là thứ ping cả kênh đọc, không nên để ai cũng tạo.
- Câu hỏi/đáp án đi qua `allowedMentions: { parse: [] }`.
- Bỏ đáp án trống, cắt 55 ký tự mỗi đáp án (trần của Discord), tối thiểu 2 đáp án.

## Files

Tạo: `src/commands/poll.ts`
Sửa: `scripts/self-check.js`, `docs/community-management.md`

## Rủi Ro

| Rủi ro | Xử lý |
|---|---|
| Bản discord.js không có `poll` | Đã kiểm: `^14.27.0` trong package.json — có từ 14.16 |
| Poll ping cả kênh | `parse: []` + yêu cầu `ManageMessages` |
| Đáp án quá dài / trống | Cắt 55 ký tự, bỏ đáp án trống, đòi ≥ 2 |
