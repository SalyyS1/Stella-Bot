# Phase 07 — Highlight, auto-thread, embed builder

Trạng thái: DONE
Phụ thuộc: P5 (migration)

## 7. Highlight từ khoá

Carl-bot gọi là "highlight": ai nhắc từ khoá của bạn thì bạn nhận DM kèm ngữ cảnh.

- `/highlight add <từ>` · `remove <từ>` · `list` · `clear` — **mọi member dùng được**
  (đây là tính năng cá nhân, không phải công cụ quản lý).
- Cắm vào `messageCreate`, sau automod. Khớp theo từ (cùng regex ranh giới với tag).
- Cache toàn bộ cặp (userId, keyword) trong RAM, TTL 60s — hàm chạy trên mọi tin nhắn.

Cổng chống lạm dụng (highlight là đường DM ẩn danh, dễ thành công cụ theo dõi):
- Từ khoá ≥ 3 ký tự, ≤ 50 ký tự. Từ 1-2 ký tự khớp gần như mọi câu.
- Tối đa 10 từ khoá mỗi người.
- **Không** DM về tin của chính mình.
- **Không** DM nếu người đặt không có quyền đọc kênh đó — nếu không thì highlight là cách
  đọc lén kênh riêng: đặt từ khoá phổ biến rồi nhận nguyên văn tin nhắn từ kênh mình
  không được vào.
- Nhịp tối thiểu 5 phút mỗi (người, kênh) để một cuộc trò chuyện dùng từ đó không thành
  20 cái DM.
- Không DM khi người đó đang online **và** vừa chat trong kênh đó trong 5 phút (họ đang đọc rồi).

## 8. Auto-thread

- `/autothread on [channel] [template] [archive]` · `off` · `list` — `ManageThreads`.
- Mọi tin nhắn của người thật trong kênh đó tự mở thread. Bỏ qua bot và bỏ qua tin không
  có nội dung lẫn file.
- Tên thread từ template `{user}` / `{content}`; cắt 90 ký tự.
- Kênh `share`/`showcase` đã có logic mở thread riêng trong `messageCreate` → nếu ai bật
  autothread cho hai kênh đó thì bỏ qua, tránh mở hai thread cho một tin.

## 9. `/embed` builder

- `/embed <title> <description> [color] [image] [footer] [channel]` — `ManageMessages`.
- Gửi dưới danh nghĩa bot, `allowedMentions: { parse: [] }`. Không có dòng đó thì `/embed`
  là công cụ ping `@everyone` trông rất chính thức.
- Màu nhận `#rrggbb`; sai định dạng thì rơi về màu mặc định chứ không lỗi.
- Ảnh chỉ nhận URL `https` (dùng `safe-public-url.ts` đã có nếu khớp API).

## Files

Tạo: `src/systems/utility/highlight-manager.ts`, `src/systems/utility/autothread-manager.ts`,
`src/commands/highlight.ts`, `src/commands/autothread.ts`, `src/commands/embed.ts`

Sửa: `src/events/messageCreate.ts`, `scripts/self-check.js`

## Rủi Ro

| Rủi ro | Xử lý |
|---|---|
| Highlight đọc lén kênh riêng | Kiểm `ViewChannel` của người đặt trước khi DM |
| Highlight spam DM | Nhịp 5 phút/kênh, bỏ qua khi người đó vừa chat ở đó |
| Autothread mở thread rác | Bỏ qua tin trống; bỏ qua kênh đã có logic thread riêng |
| `/embed` ping everyone | `parse: []` + assertion trong self-check |
