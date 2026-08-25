# Quản Lý Tầng 2 — Báo Cáo Cook

Ngày: 2026-08-25
Plan: `plans/260825-1558-quan-ly-tang-2-not-phan-con-lai/`
Branch: main (chưa commit)

## Kết Quả

Cook xong 4/4 phase. `npm run build` OK · self-check **157 assertion** pass ·
**26 unit test** pass. **52 lệnh** tổng (trước đợt này 43).

Hết danh sách "chưa làm". Không còn tính năng nào của Carl-bot / Dyno / ProBot /
VoiceMaster mà bot chưa có.

## Đã Làm

| Phase | Nội dung | File mới |
|---|---|---|
| 5 | Migration 6 bảng · log voice · cảnh báo acc lạ (nút Kick/Ban) · `/watch` · `/lockdown` · `/slowmode` | 7 |
| 6 | `/autorole` · `/role add @u @r 3d` + scheduler | 4 |
| 7 | `/highlight` · `/autothread` · `/embed` | 5 |
| 8 | `/modreport` + tự đăng Chủ nhật | 2 |

Migration: `20260825040000_management_tier2` — `WatchTarget`, `ChannelLock`, `AutoRole`,
`TempRole`, `Highlight`, `AutoThreadChannel`. Toàn bộ `CREATE TABLE IF NOT EXISTS`.

Sửa: `prisma/schema.prisma`, `config.ts` (`logs.voice`, `moderation.watchMaxDays`,
`moderation.tempRoleMaxDays`), `events/{voiceStateUpdate,guildMemberAdd,messageCreate,interactionCreate,ready}.ts`,
`scripts/self-check.js`, `docs/community-management.md`.

## Quyết Định Đáng Ghi Lại

**Log voice ghép vào `voiceStateUpdate.ts` đã có** thay vì tạo file event thứ hai cho cùng
một event — thứ tự chạy (dọn/tạo phòng trước, log sau) nhìn thấy được ở một chỗ.

**Bản tin kiểm duyệt tách hẳn khỏi `report-weekly.ts`.** Cái đó là tờ báo cộng đồng do AI
viết, đăng kênh nhật báo. Bản tin này là số liệu nội bộ, không AI, đăng botLog. Ghép vào
nhau thì một lỗi số liệu kiểm duyệt sẽ chặn cả tờ báo. Dùng lại `claimWork`/`releaseWork`
để chống đăng trùng.

**`/watch` là Administrator, không phải ModerateMembers.** Đây là công cụ theo dõi người
thật, không phải lệnh kiểm duyệt thường ngày. Bảng `WatchTarget` không cho `expiresAt`
null — theo dõi vô thời hạn là thứ người ta bật rồi quên.

**Mục bằng 0 bị bỏ khỏi `/modreport`** chứ không in "0". Một bản tin toàn số 0 làm người
đọc bỏ luôn thói quen mở nó.

## Lỗi Đã Chặn Trước Khi Chạy

1. **`/lockdown off` phá quyền gốc của kênh.** Mở khoá bằng `SendMessages: true` sẽ ghi đè
   cấu hình gốc — một kênh thông báo mà admin cố ý khoá `@everyone` sẽ thành kênh ai cũng
   chat được, và không ai nối được chuyện đó với lệnh lockdown chạy tuần trước. Dùng
   `null` (xoá overwrite). Có assertion.

2. **Highlight thành đường đọc lén.** Đặt một từ khoá phổ biến rồi nhận nguyên văn tin
   nhắn từ kênh mình không được vào. Chặn bằng `permissionsFor(member).has(ViewChannel)`
   trước khi DM. Có assertion.

3. **Autorole thành đường leo thang quyền tự động.** Nó cấp cho MỌI người vào server, nên
   đi qua `checkRoleAssignable` **hai lần** — lúc `/autorole add` và lúc cấp cho từng
   người (role có thể được cấp thêm quyền sau khi đã vào danh sách). Có assertion cho cả hai.

4. **Role tạm sống thêm cả đêm.** Scheduler nhịp 60s mà chỉ chạy từ tick đầu tiên thì
   role đáng ra hết hạn lúc bot tắt sẽ giữ thêm nguyên khoảng bot tắt. Quét một lượt ngay
   khi `startTempRoleScheduler` được gọi. Có assertion.

5. **Bản tin không bao giờ chạy.** `Intl` không chỉ rõ `timeZone` thì trên host ≥ UTC+10,
   Chủ nhật 20h Saigon đã là thứ Hai bên host — lỗi im lặng, đúng cái bẫy đã ghi trong
   `report-weekly.ts:31`. Pin `config.maintenance.timezone`. Có assertion.

6. **Auto-thread mở hai thread cho một tin.** `share`/`showcase` đã có logic thread riêng
   trong `messageCreate`; `openAutoThread` bỏ qua hai kênh đó một lần nữa.

7. **`/embed` ping `@everyone` một cách chính thức.** `parse: []`. Có assertion.

8. **Cảnh báo acc lạ kick oan người thật.** "Acc mới, không avatar" cũng đúng với người
   vừa lập Discord để vào server bạn bè. Chỉ báo khi có ≥ 2 dấu hiệu hoặc acc quá mới, và
   bot **không tự xử** — nút cho mod bấm, có kiểm lại quyền `KickMembers`.

## Cần Làm Trước Khi Chạy

1. `npx prisma migrate deploy` — có **hai** migration chưa chạy trên DB thật:
   `20260825030000_community_management_suite` và `20260825040000_management_tier2`.
2. Quyền bot cần thêm so với đợt trước: `Manage Threads`, `Kick Members`, `Ban Members`.
3. Setup: `/autorole add @Member` · `/autothread on` ở kênh cần · `/starboard setup` ·
   `/tempvoice setup` · `/verify setup`.

## Chưa Kiểm Chứng

**Chưa test tay trên server thật.** Build + self-check + unit test chỉ chứng minh code
biên dịch được và các invariant còn nguyên. Chưa chứng minh: log voice có gộp đúng phiên,
nút Kick trên cảnh báo acc lạ có kick được, role tạm có gỡ đúng hạn, DM highlight có tới.

## Câu Hỏi Còn Mở

1. **Log voice có ồn quá không?** Server đông người trong voice cả ngày thì đây là nhóm
   log ồn nhất trong khi giá trị thấp hơn log tin nhắn. Tắt bằng
   `config.logs.voice.enabled = false` nếu thấy ngập.
2. **Ngưỡng cảnh báo acc lạ.** Đang là "acc < 7 ngày **hoặc** ≥ 2 dấu hiệu". Nếu server
   thường có người mới lập Discord thì nên nâng lên "≥ 2 dấu hiệu" cho cả nhánh acc mới.
3. **Log voice chưa lưu bảng** nên chưa làm được "top thời gian voice". Muốn có thì cần
   thêm một bảng `VoiceSession` — chưa làm vì chưa ai yêu cầu.
4. **`/autorole` và cổng invite.** Người mới nhận autorole ngay, nhưng lượt mời chỉ được
   tính khi họ pick role + ở lại 24h. Hai luồng độc lập, không xung đột — nhưng nếu
   autorole cấp luôn role member thì cổng "pick role để giúp người mời" mất một phần lý do
   tồn tại. Cân nhắc khi chọn role cho `/autorole`.
