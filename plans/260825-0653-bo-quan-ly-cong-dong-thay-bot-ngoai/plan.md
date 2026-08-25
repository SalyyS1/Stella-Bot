# Bộ Quản Lý Cộng Đồng — Gỡ Carl-bot / Dyno / ProBot / VoiceMaster

Ngày: 2026-08-25
Trạng thái: DONE (cook cả 4 phase; build + 147 assertion self-check + 26 unit test pass)
Branch: main

## Vì Sao Có Kế Hoạch Này

Đợt trước (`plans/260825-0249-invite-tracking-va-admin-message-logs/`) đã cook xong invite + log
kiểm duyệt, và **đã thêm sẵn schema + config** cho 7 hệ thống quản lý còn lại —
nhưng chưa viết một dòng code nào cho chúng:

| Bảng đã có trong DB | Code | Thay bot nào |
|---|---|---|
| `AutomodSetting`, `AutomodStrike` | ❌ chưa có | automod của Carl-bot / Dyno / ProBot |
| `RoleMenu`, `RoleMenuOption` | ❌ chưa có | reaction role của Carl-bot |
| `TempVoiceHub`, `TempVoiceChannel` | ❌ chưa có | **VoiceMaster** |
| `Tag` | ❌ chưa có | tag Carl-bot / custom command Dyno |
| `StickyMessage` | ❌ chưa có | sticky của Carl-bot |
| `StarboardPost` | ❌ chưa có | starboard của Carl-bot |
| `AfkStatus` | ❌ chưa có | AFK của Dyno / ProBot |

`config.automod`, `config.roleMenu`, `config.tempVoice`, `config.utility` cũng đã có
ngưỡng mặc định. Việc của kế hoạch này là **viết phần thân**, không phải thiết kế lại.

## Chốt Của Saly (2026-08-25)

| Vấn đề | Chốt |
|---|---|
| Phạm vi | 7 hệ thống lõi trước; tầng 2 (log voice, `/watch`, highlight, lockdown, role tạm, digest tuần) để sau |
| Automod tự ra tay | **KHÔNG.** Chỉ xoá tin + báo mod. Không tự timeout |
| Cổng xác minh | **Có** — nút verify cấp role member |
| GlitchBucket | Bỏ qua, không cần thay |

Hệ quả của "chỉ xoá + báo mod": `config.automod.escalation` (3 strike → warn,
5 → timeout 10p, 8 → timeout 1h) **không được thi hành tự động**. Strike vẫn đếm, nhưng
khi chạm mốc thì bot gửi cảnh báo cho mod kèm nút bấm một phát là xử — mod quyết, bot
không quyết. Cố ý **không** thêm cờ `autoPunish`: một cờ nằm trong config mà không có
đường thi hành là cái bẫy cho người đọc code sau này. Muốn bot tự phạt thì phải viết
nhánh đó trong `automod-service.ts`, và lúc đó self-check sẽ báo (xem assertion
"automod must not punish on its own").

## Phases

| # | Phase | File | Phụ thuộc |
|---|---|---|---|
| 1 | Automod: 11 luật, strike, xoá tin, cảnh báo mod có nút xử | [phase-01-automod-xoa-tin-va-bao-mod.md](phase-01-automod-xoa-tin-va-bao-mod.md) | — |
| 2 | Role menu + cổng verify | [phase-02-role-menu-va-cong-verify.md](phase-02-role-menu-va-cong-verify.md) | — |
| 3 | Phòng voice tạm (thay VoiceMaster) | [phase-03-phong-voice-tam-thay-voicemaster.md](phase-03-phong-voice-tam-thay-voicemaster.md) | — |
| 4 | Tag/autoresponder, sticky, starboard, AFK | [phase-04-tag-sticky-starboard-afk.md](phase-04-tag-sticky-starboard-afk.md) | — |

Bốn phase độc lập nhau (khác bảng, khác event). Thứ tự trên là thứ tự giá trị giảm dần.

## Nguyên Tắc Bảo Mật Áp Cho Cả 4 Phase

Đây là phần khiến việc tự làm khác với việc cắm một bot lạ có quyền Administrator:

1. **Không bao giờ cấp role mà bot không có quyền cấp.** Mọi đường cấp role
   (role menu, verify, temp role) phải kiểm `role.position < bot.roles.highest.position`,
   chặn `role.managed` (role của bot/nitro) và chặn role có `Administrator`/`ManageGuild`/
   `ManageRoles`/`BanMembers`/`KickMembers`. Không kiểm thì `/rolemenu add` biến thành
   đường leo thang quyền cho bất kỳ ai bấm được nút.
2. **Automod miễn trừ mod.** Người đang dọn spam phải dán được link và ping được nhiều
   người. Automod chặn đúng những người đang chữa cháy là lỗi tệ nhất của loại tính năng này.
3. **Automod không tự phạt** (chốt của Saly) → không có đường nào để một tin nhắn đơn lẻ
   khiến member thật bị khoá miệng vì bot đọc sai.
4. **Tag/sticky/autoresponder không được mang mention.** Nội dung do admin nhập được gửi
   với `allowedMentions: { parse: [] }`; nếu không thì `/tag create` là công cụ ping
   `@everyone` cho bất kỳ ai có quyền tạo tag.
5. **Temp voice: quyền chỉ trong phòng của mình.** Chủ phòng đổi được tên/khoá/limit
   phòng CỦA HỌ, không chạm được kênh khác. Panel kiểm `ownerId` mỗi lần bấm, không tin
   `customId`.
6. **Mọi lệnh cấu hình = `ManageGuild` trở lên**, kiểm lại trong `execute` chứ không chỉ
   `setDefaultMemberPermissions` (cái đó admin server tắt được trong UI).
7. **Starboard không tự ping.** Đăng lại tin của người khác kèm ping tác giả là biến
   starboard thành máy quấy rối.

## Acceptance Criteria

- `npm run build` pass; `npm test` (self-check) pass sau mỗi phase.
- Automod: spam 7 tin/5s → tin bị xoá, botLog có 1 embed gộp, member nhận nhắc nhở ephemeral-ish
  (tin tự xoá sau 8s), KHÔNG bị timeout. Mod bấm nút "Timeout 10p" thì mới bị.
- Automod: mod/role tin cậy spam link → không bị chặn.
- `/automod disable flood` → luật tắt ngay, không cần restart.
- `/rolemenu` tạo được menu nút và menu select; bấm nút cấp/gỡ role đúng; mode `unique`
  chỉ giữ 1 role; thêm role cao hơn bot → bị từ chối kèm lý do.
- `/verify setup` → người mới bấm nút được role member; bấm lần 2 không mất role.
- Vào kênh hub voice → phòng riêng được tạo, panel hiện trong phòng; rời phòng → sau 15s
  phòng bị xoá; restart bot giữa lúc có phòng mở → phòng rỗng vẫn được dọn.
- Người không phải chủ phòng bấm panel → bị từ chối.
- `/tag create` + `/tag show`; tag có `autoTrigger` tự trả lời trong chat, có cooldown 30s.
- `/sticky set` → nội quy được đăng lại sau mỗi 5 tin, bản cũ bị xoá (không nhân đôi).
- Thả ⭐ đủ 4 lượt → tin lên starboard; bỏ sao xuống dưới ngưỡng → post starboard bị xoá;
  tự thả sao cho mình không tính.
- `/afk` → ai ping mình sẽ được bot nhắc; mình chat lại thì AFK tự tắt.

## Rollback

Từng phase revert độc lập bằng commit. Không phase nào cần migration mới (schema đã có
từ đợt trước), nên rollback code là đủ — bảng bỏ không thì vô hại. Riêng phase 3 nếu
revert khi đang có phòng temp mở thì phải xoá tay các kênh đó (bot sẽ không còn biết
chúng là của mình).

## Câu Hỏi Còn Mở

Ghi ở cuối mỗi phase file, sau khi cook.
