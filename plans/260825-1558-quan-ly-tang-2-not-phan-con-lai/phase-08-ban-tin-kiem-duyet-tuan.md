# Phase 08 — Bản tin kiểm duyệt tuần

Trạng thái: DONE
Phụ thuộc: P5 (dữ liệu watch/lock), và dữ liệu đã có từ hai đợt trước

## Vì Sao Tách Khỏi Nhật Báo

`src/systems/report/report-weekly.ts` là **tờ báo cộng đồng** do AI viết, đăng ở kênh nhật
báo cho mọi người đọc. Bản tin kiểm duyệt là số liệu nội bộ cho mod, đăng ở botLog, và
không cần AI. Nhồi hai thứ vào một pipeline sẽ làm cả hai khó sửa: một lỗi số liệu kiểm
duyệt sẽ chặn cả tờ báo cộng đồng.

Dùng lại `claimWork`/`releaseWork` (`report-claim.ts`) để không đăng trùng khi restart.

## Nội Dung Bản Tin

Đọc từ bảng đã có, không thêm bảng nào:

| Mục | Nguồn |
|---|---|
| Tin bị xoá / bị sửa trong tuần | `MessageMirror` (`deletedAt`, `editedAt`) |
| Top 5 người bị xoá tin nhiều nhất | `MessageMirror` groupBy `authorId` |
| Hồ sơ kỷ luật mới (warn/timeout/kick/ban) | `ModCase` groupBy `kind` |
| Lượt vi phạm automod theo luật | `AutomodStrike` groupBy `rule` |
| Người mới + tỷ lệ giữ người | `InviteJoin` (`status`, `leftAt`) |
| Acc bị từ chối vì quá mới | `InviteJoin` status `REJECTED_YOUNG` |
| Đang bị theo dõi / kênh đang khoá | `WatchTarget`, `ChannelLock` |

Con số nào bằng 0 thì **bỏ khỏi embed** chứ không in "0" — một bản tin toàn số 0 làm người
đọc bỏ luôn thói quen đọc nó.

## Cách Chạy

- `/modreport [ngày]` — mod gọi tay, mặc định 7 ngày. `ModerateMembers`.
- Tự đăng: nhịp riêng 60 phút trong `ready`, chỉ đăng khi là **Chủ nhật giờ Saigon** và
  giờ ≥ 20h. Dùng `isSundaySaigon()` có sẵn + `claimWork('modreport', <tuần>)`.
  Kiểm giờ theo `config.maintenance.timezone` — dùng giờ host thì trên host UTC+10 bản tin
  không bao giờ chạy (đúng cái bẫy đã ghi trong `report-weekly.ts:31`).

## Files

Tạo: `src/systems/moderation/mod-digest.ts`, `src/commands/modreport.ts`
Sửa: `src/events/ready.ts`, `scripts/self-check.js`, `docs/community-management.md`

## Kiểm Chứng

- `/modreport 30` in ra embed có số liệu khớp với `/inspect` của một vài người.
- Gọi hai lần liền nhau vào Chủ nhật: lần thứ hai bị `claimWork` chặn (không đăng trùng).

## Rủi Ro

| Rủi ro | Xử lý |
|---|---|
| Query nặng trên bảng mirror lớn | Chỉ `count` và `groupBy` có `where` theo thời gian, đều có index |
| Đăng trùng khi restart | `claimWork` giữ claim sau khi đăng thành công |
| Sai múi giờ → không bao giờ chạy | `isSundaySaigon()` + `Intl` với `timeZone` chỉ định rõ |
