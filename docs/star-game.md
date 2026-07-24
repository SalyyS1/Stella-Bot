# Star Game Của Stella

Star Game là minigame hái sao bằng slash command `/star`. Người chơi nhận `Wooden Net` Lv.1 mặc định, có thể mua và nâng cấp tool bằng Scoin.

## Hái Sao

```text
/star hunt
/star hunt area:meteor_field
/star hunt area:black_hole_gate tool:rocket_drill
```

- Option `tool` của `/star hunt` không bắt buộc. Nếu bỏ trống, Stella tự chọn tool đang sở hữu có level cao nhất.
- Nếu nhiều tool cùng level, Stella ưu tiên theo thứ tự nội bộ; hãy chọn `tool` khi cần dùng một tool cụ thể.
- Khu vực mặc định là `Stella Sky`.
- `Black Hole Gate` chỉ mở khi chọn `Rocket Drill` từ Lv.6 trở lên. Tool khác đạt Lv.6 vẫn không vào được.

## Tool Và Buff

```text
/star shop
/star shop buy:rocket_drill
/star upgrade tool:rocket_drill
```

- Tool đã mua là vĩnh viễn và có thể nâng tối đa Lv.10.
- Mỗi buff có thời lượng 30 phút.
- Mua lại đúng buff khi buff đó còn hoạt động sẽ gia hạn thêm 30 phút từ thời điểm hết hạn hiện tại; giao dịch vẫn trừ Scoin theo giá shop.
- `/star bag` hiển thị tool và buff đang hoạt động; `/star collection` hiển thị thêm các vật phẩm còn thiếu.

## Minigame cược nhanh

- `/game coinflip`: thắng lời bằng đúng tiền cược (tổng trả về x2), thua mất tiền cược.
- `/game dice`: đoán đúng 1-6 sẽ lời x5 tiền cược, thua mất tiền cược.
- Mỗi lượt được trừ/trả Scoin nguyên tử trước animation; không thể né kết quả bằng thao tác số dư đồng thời.

## Lệnh Liên Quan

| Lệnh | Mục đích |
|---|---|
| `/star bag` | Xem túi sao, tool và buff đang có |
| `/star collection` | Xem bộ sưu tập và vật phẩm còn thiếu |
| `/star event` | Xem event bầu trời hiện tại |
| `/star sell` | Bán toàn bộ sao trong túi lấy Scoin |
| `/star shop` | Xem hoặc mua tool/buff |
| `/star upgrade` | Nâng cấp tool đang sở hữu |
