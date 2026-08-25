# Phase 12 — Thời gian voice + `/voicetop`

Trạng thái: DONE (2026-08-26)
Phụ thuộc: P9 (migration)

## Đo Cái Gì Mới Đúng

Một bảng xếp hạng "thời gian trong voice" thô sẽ đo **ai để máy chạy lâu nhất**, không đo
ai tham gia nhiều nhất. Hai khoảng phải bị loại:

1. **Kênh AFK của server** (`guild.afkChannelId`) — Discord tự đẩy người idle vào đó. Đếm
   nó là trả thưởng cho việc bỏ máy đấy.
2. **Khoảng tự tắt tai nghe** (`selfDeaf`) — tắt tai nghe nghĩa là không nghe. Đây là dấu
   hiệu rõ ràng nhất và là dữ liệu Discord gửi sẵn trong `VoiceState`.

Nên phiên tính điểm **bắt đầu** khi vào một kênh voice không phải AFK và không self-deaf,
và **kết thúc** khi rời / chuyển kênh / bật self-deaf. Bật lại tai nghe thì mở phiên mới.

Không loại "ngồi một mình": ngồi một mình chờ bạn vào vẫn là dùng server, và tính "có ai
khác trong kênh" cho từng giây đòi phải đánh giá lại mỗi lượt người khác vào/ra — phức tạp
hơn nhiều so với giá trị nó thêm.

## Yêu Cầu

- Cắm vào `src/events/voiceStateUpdate.ts` đã có (temp voice + log voice đang dùng).
- Bảng `VoiceActivity` là **tổng dồn**, không phải nhật ký từng phiên: một dòng mỗi người.
  Nhật ký phiên sẽ phình vô hạn và không ai truy vấn nó.
- `weekKey` dùng `weekKeyFor` có sẵn (`weekly-reward-manager.ts`). Tuần đổi thì
  `weekSeconds` reset — reset **lúc ghi** (so `weekKey` đã lưu với tuần hiện tại), không
  cần scheduler quét cả bảng vào nửa đêm.
- Bỏ bot.
- Phiên < 60 giây không ghi: vào/ra liên tục sinh hàng loạt lượt ghi DB cho vài giây vô nghĩa.
- Lúc bot tắt: phiên đang mở bị mất (nằm trong RAM). Chấp nhận — đổi lại là không phải ghi
  DB mỗi phút cho mỗi người đang trong voice.
- `/voicetop [range]` — `week` (mặc định) | `all`. Top 10, kèm hạng của người gọi.
- `/profile` thêm một dòng thời gian voice.

## Files

Tạo: `src/systems/stats/voice-activity-manager.ts`, `src/commands/voicetop.ts`
Sửa: `src/events/voiceStateUpdate.ts`, `src/commands/profile.ts`, `scripts/self-check.js`

## Rủi Ro

| Rủi ro | Xử lý |
|---|---|
| Bảng xếp hạng chỉ đo ai treo máy | Loại kênh AFK + loại khoảng self-deaf |
| Bảng phình vô hạn | Tổng dồn một dòng mỗi người, không ghi nhật ký phiên |
| Mất giờ khi bot restart | Chấp nhận, ghi rõ trong docs; đổi lại không ghi DB mỗi phút |
| Reset tuần sai múi giờ | Dùng `weekKeyFor` có sẵn (đã pin timezone Saigon) |
