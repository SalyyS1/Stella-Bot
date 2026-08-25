# Bộ Quản Lý Cộng Đồng — Báo Cáo Cook

Ngày: 2026-08-25
Plan: `plans/260825-0653-bo-quan-ly-cong-dong-thay-bot-ngoai/`
Branch: main (chưa commit)

## Kết Quả

Cook xong 4/4 phase. `npm run build` OK · self-check **147 assertion** pass ·
**26 unit test** pass (automod 12, diff 8, giveaway 6).

Phát hiện quan trọng lúc soát repo: đợt trước đã tạo sẵn **schema + migration + config**
cho 7 hệ thống này nhưng **chưa có dòng code nào**. Nên đợt này không cần migration mới —
chỉ viết phần thân.

## Đã Làm

| # | Hệ thống | File chính | Lệnh |
|---|---|---|---|
| 1 | Automod 11 luật, strike, cảnh báo mod có nút xử | `systems/automod/` (6 file) | `/automod` |
| 2 | Role menu + cổng verify | `systems/rolemenu/` (5 file) | `/rolemenu`, `/verify` |
| 3 | Phòng voice tạm | `systems/tempvoice/` (4 file) + `events/voiceStateUpdate.ts` | `/tempvoice` |
| 4 | Tag/autoresponder, sticky, starboard, AFK | `systems/utility/` (5 file) | `/tag` `/sticky` `/starboard` `/afk` |

23 file mới, 8 lệnh mới (43 lệnh tổng). Sửa: `messageCreate`, `interactionCreate`, `ready`,
`messageDelete`, `messageReactionAdd/Remove`, `message-log-sender`, `config.ts`,
`self-check.js`, `package.json`.

## Quyết Định Đáng Ghi Lại

**Automod không tự phạt** (Saly chốt). Hệ quả: `config.automod.escalation` chỉ còn là
gợi ý — chạm mốc thì bot đăng embed đỏ kèm 4 nút cho mod bấm. Cố ý **không** thêm cờ
`autoPunish` như plan ban đầu ghi: một cờ config không có đường thi hành là bẫy cho người
đọc code sau. Self-check có assertion chặn việc nối timeout thẳng vào automod.

**`sendMessageLog` giờ trả về `Message | null`** thay vì `void`. Cần để automod SỬA embed
log cũ khi gộp nhiều lượt vi phạm liên tiếp. Thay đổi tương thích ngược — mọi chỗ gọi cũ
bỏ qua giá trị trả về.

**Starboard dùng `ManagedChannel` làm KV** (key `starboard` + `starboard:threshold`) thay
vì thêm bảng. Cột tên `channelId` nhưng thực chất là cột chuỗi dùng chung —
`skillRoleManager.ts` đã dùng đúng cách này cho role id.

## Lỗi Đã Chặn Trước Khi Chạy

1. **Automod xoá bài quảng cáo.** `inviteLink` bật mặc định + automod chạy trước
   `publishServerAd` ⇒ mọi bài trong `serverAds` (vốn **bắt buộc** có link mời) sẽ bị xoá
   trước khi bot kịp xử lý form, người đăng chỉ thấy bài biến mất. Đã miễn trừ cứng 3 kênh
   `serverAds` / `share` / `showcase`, và cho DB **cộng thêm** chứ không ghi đè — nếu ghi
   đè thì lần đầu ai đó chạy `/automod exempt` sẽ âm thầm gỡ cả ba.

2. **Tiếng Việt bị coi là zalgo.** Chuỗi NFD (`ế` = `e` + 2 dấu phụ rời) có mật độ dấu phụ
   gần bằng zalgo. Đã chuẩn hoá NFC trước khi đếm; có test riêng cho cả NFC lẫn NFD.

3. **Leo thang quyền qua role menu.** `role-assignable-gate.ts` chặn role `managed`,
   `@everyone`, role ≥ role bot, và 10 quyền quản trị. Kiểm **hai lần**: lúc `/rolemenu add`
   và lúc bấm nút (role có thể được cấp thêm quyền sau khi đã vào menu).

4. **customId giả.** Role menu đối chiếu `roleId` với option trong DB; panel voice đọc
   `ownerId` từ DB. Không tin customId ở cả hai chỗ.

5. **`/tag` thành công cụ ping `@everyone`.** Mọi nội dung admin nhập gửi với
   `allowedMentions: { parse: [] }`. Có assertion.

6. **Kênh log bị ngập lúc raid.** Gộp log theo (người, luật) trong 60s — sửa embed cũ, đếm
   số lần, thay vì đăng embed mới.

## Cần Làm Trước Khi Chạy Bản Này

1. `npx prisma migrate deploy` — migration `20260825030000_community_management_suite` đã
   có sẵn trong repo nhưng **chưa chạy trên DB thật** (chưa commit).
2. Cấp bot: `Manage Roles`, `Manage Channels` (hai quyền mới so với trước).
3. Chạy setup theo thứ tự trong `docs/community-management.md`.
4. **Automod bật ngay khi deploy** (`config.automod.enabled = true`). Nếu muốn quan sát
   trước: `/automod off` ngay sau khi bot lên, rồi bật lại sau khi xem `/automod status`.

## Chưa Làm

Tầng 2 (Saly hoãn): log voice, cảnh báo acc lạ lúc join kèm nút Kick/Ban, `/watch`,
highlight keyword, `/lockdown` + `/slowmode`, role tạm có hạn, autorole lúc join,
`/embed` builder, auto-thread, bản tin kiểm duyệt tuần.

Kiểm chứng còn thiếu: **chưa test tay trên server thật**. Build + self-check + unit test
chỉ chứng minh code biên dịch được và các invariant còn nguyên; chúng không chứng minh
được phòng voice thật sự tạo ra, hay nút role thật sự cấp role. Cần một lượt chạy thử.

## Câu Hỏi Còn Mở

1. **Automod có nên bật `links` không?** Đang tắt. Bật thì phải liệt kê allowlist, không
   thì chặn cả link YouTube/GitHub anh em dán hàng ngày.
2. **Ngưỡng starboard 4 sao** hợp với server bao nhiêu người online? Số này chỉnh bằng
   lệnh nên không chặn, nhưng đặt sai lần đầu thì bảng vàng hoặc trống trơn hoặc đầy rác.
3. **`/verify` cần khoá kênh tay.** Muốn tôi viết thêm `/verify lockchannels` để bot tự sửa
   quyền `@everyone` hàng loạt không? Tôi cố ý không làm vì khó lùi — nhưng nếu server có
   nhiều kênh thì làm tay cũng dễ sót.

Đã tự kiểm và loại: `!tag` không đụng hệ thống nhạc (nhạc dùng prefix `s!`, xem
`music-prefix-commands.ts:13`).
