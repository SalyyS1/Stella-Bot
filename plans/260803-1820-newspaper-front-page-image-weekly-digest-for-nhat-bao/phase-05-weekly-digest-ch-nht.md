---
phase: 5
title: "Weekly digest (Chủ nhật)"
status: pending
priority: P2
effort: "4h"
dependencies: [4, 2]
---

# Phase 5: Weekly digest (Chủ nhật)

## Overview

Chủ nhật, trong tick nhật báo — sau khi `runReport` xử lý xong (dù bản tin CN đăng
hay 'empty') — đọc 7 bài `ReportDaily` (tuần CN-21h trước → CN-21h này, khớp cửa sổ
nhật báo) → 1 lượt AI gộp thành "TỔNG HỢP TUẦN VỪA QUA" → đăng bài riêng + ảnh tờ
báo "SỐ ĐẶC BIỆT" (măng-sét đổi màu để phân biệt). Chống trùng bằng claim
`report-weekly`.

## Requirements

- Functional:
  - `runWeeklyDigest(client, force = false): Promise<'posted'|'empty'|'already'|'disabled'>`
    trong `report/report-weekly.ts`:
    1. `config.report.weekly.enabled` + `isAiEnabled()` → else `disabled`.
    2. Khoá tuần = thứ Hai của tuần hiện tại (tái dùng `weekKeyFor` từ
       `weekly-reward-manager.ts`); claim qua `MaintenanceLog`
       `{ channelId: config.report.forumChannel, kind: 'report-weekly', period: mondayKey }`
       — chung cơ chế `claim()` của scheduler.
    3. `loadDailyReports(7 periods T2→CN)` — lọc theo đúng tuần: tuần = CN vừa rồi
       về trước 6 ngày (7 period, dùng `periodDaysAgo` từ `report-time-window`).
    4. Ít hơn `config.report.weekly.minDays` (mặc định 3) row → `empty` (tuần bot
       chết gần hết, bài tuần chỉ là rác).
    5. 1 lượt AI: system prompt giọng "SỐ ĐẶC BIỆT" — nhìn lại tuần như phóng viên
       cuối tuần: chuyện lớn nhất tuần, mạch chuyện xuyên ngày (drama nổ T3, đỉnh T5,
       dịu CN), ai là nhân vật của tuần; vẫn trung lập khi thuật xích mích, có tên
       người; vẫn bỏ riêng tư thật. Input = 7 bài ngày (mỗi bài tới vài chục ký tự —
       cắt mỗi bài còn ~6.000 ký tự theo trần `maxContextCharsPerDay` trong config,
       giữ ngày mới nhất đủ — đúng tinh thần cap từ trước).
    6. Render ảnh tuần: `buildFrontPageImage` (phase 3) với `headline = "TỔNG HỢP
       TUẦN VỪA QUA"`, sapo = 1 câu nổi bật, sections = 2-4 mảng của tuần, imagePrompt
       khác ngày thường (quy mô tuần) — hoặc đơn giản hoá: renderer hỗ trợ cờ
       `weekly: true` đổi màu măng-sét (đỏ `#b8232c`) + phụ đề "SỐ ĐẶC BIỆT".
       Fail → đăng text-only.
    7. `postReport(client, mondayKey, weeklyBody, image?)` — tái dùng publisher,
       title "SỐ ĐẶC BIỆT — TUẦN VỪA QUA".
  - Scheduler: trong tick, sau khi `runReport` xử lý xong và hôm nay là Chủ nhật
    → `runWeeklyDigest(client)` trong try/catch (fail-soft). **KHÔNG đòi hỏi
    outcome 'posted'** (chốt Validation S1): bản tin CN 'empty' (ngày chết) không
    chặn bài tuần khi tuần vẫn có ≥3 ngày dữ liệu. Claim `report-weekly` là chốt
    chống trùng duy nhất — runReport 'already' (admin đã chạy) cũng không gây
    đăng trùng tuần.
- Non-functional:
  - Claim giữ lại khi posted (như `runReport`) — restart không đăng trùng tuần.
  - Không thêm timer; kích hoạt trong tick hiện có.

## Architecture

```
report-scheduler.ts (tick, sau runReport posted && CN)
  → runWeeklyDigest(client)
      → claim('report-weekly', mondayKey)
      → loadDailyReports(tuần)          ≥ minDays
      → weekly AI (compose-weekly.ts prompt) → body
      → buildFrontPageImage(body, 'SỐ ĐẶC BIỆT...', weekly)
      → postReport(..., mondayKey, body, image)

src/systems/report/report-weekly.ts         (orchestrate + claim + gates)
src/systems/report/report-weekly-composer.ts (system prompt gộp tuần, cap context)
src/systems/report/newspaper/newspaper-canvas.ts (cờ weekly → măng-sét đỏ + phụ đề)
src/config.ts                                (report.weekly { enabled, minDays: 3, maxTokens, timeoutMs, maxContextCharsPerDay })
```

## Related Code Files

- Create: `src/systems/report/report-weekly.ts`
- Create: `src/systems/report/report-weekly-composer.ts`
- Modify: `src/systems/report/report-scheduler.ts` (gọi digest sau posted + kiểm CN)
- Modify: `src/systems/report/newspaper/newspaper-canvas.ts` (cờ weekly)
- Modify: `src/config.ts` (`report.weekly`)
- Modify: `scripts/self-check.js` (assert `report-weekly` claim period shape — theo
  mẫu assert `report-chunk` sẵn có)

## Implementation Steps

1. Config `report.weekly = { enabled: true, minDays: 3, maxTokens: 50_000,
   timeoutMs: 900_000, maxContextCharsPerDay: 6_000 }`.
2. `report-weekly-composer.ts`: system prompt "SỐ ĐẶC BIỆT" (giọng như DAILY_SYSTEM
   nhưng tầm tuần, có mục "Nhân vật tuần", "Chuyện nối dài", "Khoảnh khắc đáng nhớ");
   render 7 ngày với label ngày (thứ + period), cap mỗi ngày; trả body hoặc null.
3. `report-weekly.ts`: đúng chuỗi bước trong Requirements; tái dùng `claim`/`release`
   (export từ scheduler hoặc trích sang module dùng chung — ưu tiên export từ
   scheduler, tránh lặp). Kiểm Chủ nhật bằng `saigonNow().period` + weekday từ
   `Intl` (đúng mẫu `weekKeyFor`).
4. Canvas: thêm `weekly?: boolean` vào opts — đổi màu măng-sét + dòng phụ đề
   "SỐ ĐẶC BIỆT"; không đổi layout khác.
5. Scheduler: đặt gọi `runWeeklyDigest` ở TICK — sau `await runReport(client)`
   kết thúc (outcome bất kỳ trừ 'disabled'), kèm kiểm `isSunday` (Intl weekday,
   đúng mẫu `weekKeyFor`). Đảm bảo lỗi digest không làm hỏng tick (try/catch + log).
   Không gọi trong nhánh `if (posted)` — bài tuần phải chạy cả khi bản tin CN empty.
6. `self-check.js`: thêm assertion `report-weekly` trong kind-list của
   `pruneOldChunkClaims`? — KHÔNG: prune hiện chỉ lọc 2 kind. Quyết định: claim tuần
   cũng cần dọn — thêm `'report-weekly'` vào mảng kind của `pruneOldChunkClaims`
   (kèm assert). Tuần claim period = thứ Hai, cũ 35 ngày → nằm sau cutoff, bị xoá đúng.
7. Build + test: `npm run build`, `npm test`. Test tay: chạy `/maintenance report`
   bản admin vào Chủ nhật (hoặc gọi `runWeeklyDigest` qua script) → xem bài + ảnh tuần.

## Success Criteria

- [x] CN: sau nhật báo CN có thêm bài "SỐ ĐẶC BIỆT — TUẦN VỪA QUA" kèm ảnh măng-sét đỏ
- [x] Chạy lại tick/restart: không đăng trùng tuần (claim hoạt động)
- [x] Tuần < 3 ngày dữ liệu: bỏ qua (`empty`), không đăng rác
- [x] 1 ngày trong tuần thiếu row: bài tuần vẫn ra, kể 6 ngày còn lại
- [x] Prompt tuần tuân thủ trung lập khi thuật drama (dùng chung luật với DAILY_SYSTEM)
- [x] `npm run build` sạch, `npm test` xanh

## Risk Assessment

- **Context tuần quá dài**: 7 ngày × vài chục nghìn ký tự — cap `maxContextCharsPerDay`
  6.000 → ~42k ký tự tổng, nằm gọn trong maxTokens 50k output + cửa sổ model.
- **Đăng trùng tuần khi restart giữa claim**: claim giữ khi posted; nếu post xong mà
  chưa kịp giữ (crash giữa `postReport` và return) → thêm 1 bài tuần hiếm gặp, chấp
  nhận (khác với bản tin ngày: tuần ít giá trị "đăng lại" hơn, và crash cửa sổ này
  cực hẹp). Ghi chú trong comment.
- **Số tuần lệch ranh giới CN 21h**: period dùng ngày thứ Hai làm khoá, bài đăng CN
  tối thuộc tuần đó; 7 ngày T2-CN khớp cửa sổ nhật báo. Không dùng thứ 2 sáng làm mốc.
- **prune xoá nhầm claim tuần**: chỉ thêm kind vào danh sách prune khi đã xác nhận
  period tuần < cutoff; test nhanh bằng truy vấn sau khi prune.
