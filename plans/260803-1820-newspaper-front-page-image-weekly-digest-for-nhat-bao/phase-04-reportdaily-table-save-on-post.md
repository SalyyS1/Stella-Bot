---
phase: 4
title: "ReportDaily table + save on post"
status: pending
priority: P1
effort: "2h"
dependencies: []
---

# Phase 4: ReportDaily table + save on post

## Overview

Lưu bài nhật báo ĐÃ ĐĂNG vào bảng `ReportDaily` (period + body). Đây là nguồn dữ
liệu cho bài tổng hợp tuần (phase 5) — chunk 3h bị prune sau 7 ngày và không phải
là bài hoàn chỉnh, nên không thể dựa vào đó.

## Requirements

- Functional:
  - Prisma model:
    ```prisma
    model ReportDaily {
      id        Int      @id @default(autoincrement())
      period    String   @unique   // yyyy-MM-dd (Saigon)
      body      String
      createdAt DateTime @default(now())
    }
    ```
  - `report-daily-store.ts`:
    - `saveDailyReport(period, body): Promise<boolean>` — upsert theo `period`
      (đúng mẫu `saveChunk`), fail mềm (log, trả false).
    - `loadDailyReports(periods: string[]): Promise<Array<{period, body}>>` —
      chỉ trả row có body.trim() (bỏ row rỗng), order theo period asc.
    - `pruneOldDailyReports(days = 35): Promise<void>` — xoá row cũ hơn 35 ngày
      (lexicographic lt, đúng mẫu `pruneOldChunks`).
  - `runReport` (scheduler): ngay sau `posted = true` (cạnh chỗ đang gọi
    `pruneOldChunks`), gọi `saveDailyReport(period, body)` + `pruneOldDailyReports()`
    — fail-soft, không ảnh hưởng outcome.
- Non-functional:
  - Migration qua `npx prisma migrate dev --name report-daily` (repo dùng migrate
    deploy khi deploy — xem script `db:migrate`).
  - Không lưu ảnh, không lưu front-page JSON — chỉ body (bài tuần cần nội dung chữ).

## Architecture

```
prisma/schema.prisma → model ReportDaily
src/systems/report/report-daily-store.ts     (save/load/prune — sao mẫu chunk-store)
src/systems/report/report-scheduler.ts       (gọi save+prune sau posted, cạnh pruneOldChunks)
```

## Related Code Files

- Modify: `prisma/schema.prisma` (model `ReportDaily`)
- Create: `src/systems/report/report-daily-store.ts`
- Modify: `src/systems/report/report-scheduler.ts` (2 dòng sau `posted` block)
- Create: migration file (qua `prisma migrate dev`)

## Implementation Steps

1. Thêm model `ReportDaily` vào `prisma/schema.prisma` (sau `ReportChunk`).
2. `npx prisma migrate dev --name report-daily` — sinh migration + `prisma generate`.
3. `report-daily-store.ts`: 3 hàm theo mẫu `report-chunk-store.ts` (upsert, load
   lọc rỗng, prune lexicographic). Fail-soft + log `[report]` mọi lỗi.
4. `report-scheduler.ts`: trong `runReport`, sau `posted = await postReport(...)`
   và trong nhánh `if (posted)` — thêm:
   ```ts
   await saveDailyReport(period, body).catch(e => console.error('[report] save daily failed:', e));
   await pruneOldDailyReports().catch(e => console.error('[report] prune daily failed:', e));
   ```
   (đặt cạnh `pruneOldChunks()` hiện có).
5. `npm run build` sạch; chạy thử admin report → check DB có row `ReportDaily`.

## Success Criteria

- [x] Migration áp dụng được (deploy + local)
- [x] Sau 1 lần `/maintenance report` đăng thành công: đúng 1 row `ReportDaily` cho period đó
- [x] Chạy lại cùng ngày: upsert, không trùng (1 row/period)
- [x] Row > 35 ngày bị xoá khi prune chạy
- [x] `npm run build` sạch

## Risk Assessment

- **Migration ở host**: host dùng `prisma migrate deploy` (script `db:migrate`) —
  migration file phải commit. Không dùng `db push` ở production.
- **Body rất dài** (tới 100k token output): lưu thẳng String — Postgres không giới
  hạn TEXT. Không vấn đề.
- **Save lỗi giữa chừng**: fail-soft, tuần đó thiếu 1 ngày → phase 5 có ngưỡng ≥3
  ngày, chấp nhận được.
