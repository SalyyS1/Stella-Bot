# Quản Lý Tầng 2 — Nốt Phần Còn Lại

Ngày: 2026-08-25
Trạng thái: DONE (cook cả 4 phase; build + 157 assertion self-check + 26 unit test pass)
Branch: main
Tiếp nối: `plans/260825-0653-bo-quan-ly-cong-dong-thay-bot-ngoai/` (7 hệ thống lõi, DONE)

## Phạm Vi

Mười thứ đã ghi "chưa làm" ở cuối `docs/community-management.md`. Saly chốt: làm nốt.

| # | Tính năng | Thay bot nào | Bảng mới |
|---|---|---|---|
| 1 | Log voice (join/leave/move, thời lượng phiên) | Carl-bot voice log | — |
| 2 | Cảnh báo acc lạ lúc join, kèm nút Kick/Ban | (không bot nào có — giá trị bảo mật) | — |
| 3 | `/watch @user <thời hạn>` — copy tin của người bị theo dõi sang log | — | `WatchTarget` |
| 4 | `/lockdown` + `/slowmode` | Dyno | `ChannelLock` |
| 5 | Autorole lúc join | Dyno, Carl-bot | `AutoRole` |
| 6 | Role tạm có hạn `/role add @u @r 3d` | Dyno | `TempRole` |
| 7 | Highlight từ khoá (DM khi có người nhắc) | Carl-bot | `Highlight` |
| 8 | Auto-thread cho kênh | Carl-bot | `AutoThreadChannel` |
| 9 | `/embed` builder | Carl-bot, Dyno | — |
| 10 | Bản tin kiểm duyệt tuần | — | — |

## Phases

| # | Phase | File |
|---|---|---|
| 5 | Migration + kiểm duyệt nâng cao (1, 2, 3, 4) | [phase-05-kiem-duyet-nang-cao.md](phase-05-kiem-duyet-nang-cao.md) |
| 6 | Role tự động và role tạm (5, 6) | [phase-06-autorole-va-role-tam.md](phase-06-autorole-va-role-tam.md) |
| 7 | Highlight, auto-thread, embed builder (7, 8, 9) | [phase-07-highlight-autothread-embed.md](phase-07-highlight-autothread-embed.md) |
| 8 | Bản tin kiểm duyệt tuần (10) | [phase-08-ban-tin-kiem-duyet-tuan.md](phase-08-ban-tin-kiem-duyet-tuan.md) |

Phase 5 chứa migration cho cả 4 phase (một migration, không rải rác).

## Nguyên Tắc Bảo Mật Riêng Của Đợt Này

Đợt trước là "bot phát role, bot xoá tin". Đợt này có ba thứ nguy hiểm hơn:

1. **Autorole là đường leo thang quyền tự động.** Role cấp cho MỌI người vào server —
   phải qua đúng cổng `checkRoleAssignable` của đợt trước, và kiểm **lại** lúc cấp
   (role có thể được cấp thêm quyền sau khi đã vào danh sách autorole). Sai chỗ này thì
   mọi acc mới tạo 5 giây trước đều thành mod.
2. **`/watch` là công cụ theo dõi người thật.** Administrator-only, luôn ghi `ModCase`
   khi bật để có dấu vết ai bật và vì sao, tự tắt khi hết hạn, và có trần thời hạn.
3. **Highlight là đường DM ẩn danh.** Ai đó đặt highlight từ khoá là tên người khác thì
   họ nhận DM mỗi lần người đó được nhắc tới. Chặn: từ khoá ≥ 3 ký tự, mỗi người tối đa
   10 từ khoá, không DM khi người đặt không đọc được kênh đó, và không bao giờ DM về
   tin của chính họ.
4. **`/embed` gửi tin dưới danh nghĩa bot.** Yêu cầu `ManageMessages`, và chặn mọi
   mention (`parse: []`) — nếu không thì `/embed` là công cụ ping `@everyone` đẹp mắt.
5. **Lockdown phải lùi được.** Chỉ ghi `SendMessages: false` cho `@everyone` và lưu danh
   sách kênh đã khoá; mở khoá thì **xoá overwrite** (về `null`) chứ không set `true` —
   set `true` sẽ ghi đè cấu hình gốc của kênh mà không ai biết trước đó nó là gì.

## Acceptance Criteria

- `npm run build` pass, `npm test` pass sau mỗi phase.
- Vào/rời voice → botLog có một dòng gộp kèm thời lượng phiên.
- Acc tạo < 7 ngày vào server → embed cảnh báo kèm nút `Kick` / `Ban` / `Bỏ qua`;
  bấm Kick thì người đó bị kick và có `ModCase`.
- `/watch @u 2d` → tin của người đó được copy sang log; sau 2 ngày tự tắt.
- `/lockdown on` khoá kênh, `/lockdown off` trả kênh về **đúng** trạng thái trước đó.
- `/autorole add @Member` → người mới vào tự có role; thêm role Admin → bị từ chối.
- `/role add @u @r 30m` → role bị gỡ đúng hạn, kể cả khi bot restart giữa lúc chờ.
- `/highlight add <từ>` → có người nhắc từ đó thì mình nhận DM kèm link; tự mình nhắc thì không.
- `/autothread on` → mọi tin trong kênh đó tự có thread.
- `/embed` gửi embed có màu/tiêu đề/ảnh; nội dung chứa `@everyone` không ping ai.
- `/modreport` in ra bản tin kiểm duyệt tuần; scheduler tự đăng Chủ nhật.

## Rollback

Một migration duy nhất, toàn bộ là `CREATE TABLE` → bảng bỏ không thì vô hại.
Riêng `ChannelLock`: revert khi đang có kênh bị lockdown thì phải mở khoá tay
(bot sẽ không còn biết kênh nào nó đã khoá).
