---
phase: 1
title: "Foundation: config + Prisma model"
status: pending
priority: P1
effort: "3h"
dependencies: []
---

# Phase 1: Foundation — config + Prisma model

## Overview

Gom mọi thay đổi file dùng chung (`config.ts`, `schema.prisma`) vào một phase để Phase 3 (trivia) và Phase 4 (memory) không cùng sửa schema/config gây xung đột. Sau phase này, 02/03/04 chỉ thêm file mới + wiring.

## Requirements

- Functional: thêm `config.trivia` (kênh, tần suất, giờ ngủ, Scoin, cap) và `config.memory` (bật/tắt, giới hạn fact).
- Functional: thêm Prisma model `TriviaWin` (chống farm) và `MemberFact` (bộ nhớ), chạy migration.
- Non-functional: không phá schema hiện có; migration cộng dồn, không mất dữ liệu.

## Architecture

- **config.trivia**: đọc từ hằng số (không cần env — giá trị cố định theo quyết định user). Kênh dùng `config.channels.chat`.
- **config.memory.enabled**: đọc từ env `STELLA_MEMORY_ENABLED === 'true'` (mặc định off — bật sau khi Phase 2-3 chạy ổn).
- **TriviaWin**: 1 dòng / lần thắng, dùng đếm `count/ngày/người` để chặn farm (query theo `createdAt >= đầu ngày`).
- **MemberFact**: 1 dòng / fact, `@@unique([userId, fact])` tránh trùng, giới hạn N fact/người (xoá cũ nhất khi vượt).

## Related Code Files

- Modify: `src/config.ts` — thêm block `trivia` và `memory` (đặt cạnh `ai`).
- Modify: `prisma/schema.prisma` — thêm model `TriviaWin`, `MemberFact`; thêm quan hệ vào `User`.
- Run: `npx prisma migrate dev --name trivia_and_member_fact` (local); host tự `prisma generate` qua postinstall, migration deploy qua `npm run db:migrate`.

## Implementation Steps

1. `config.ts` — thêm sau block `image`:
   ```ts
   trivia: {
       channelId: '943893730123980881', // = channels.chat
       perDayMin: 3, perDayMax: 4,      // random 3-4 lần/ngày
       quietStartHour: 1, quietEndHour: 8, // không đăng 1h-8h (giờ VN)
       answerWindowMs: 90_000,          // thời gian mở mỗi câu
       reward: 8,                       // Scoin cho người đúng đầu tiên
       maxWinsPerDay: 5                 // cap chống farm / người / ngày
   },
   memory: {
       enabled: process.env.STELLA_MEMORY_ENABLED === 'true',
       maxFactsPerUser: 8,              // giữ tối đa 8 fact / người
       minChars: 4, maxChars: 200       // độ dài fact hợp lệ
   },
   ```
2. `schema.prisma` — thêm 2 model:
   ```prisma
   model TriviaWin {
     id        Int      @id @default(autoincrement())
     userId    String
     questionId String
     reward    Int
     createdAt DateTime @default(now())
     user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
     @@index([userId])
     @@index([createdAt])
   }

   model MemberFact {
     id        Int      @id @default(autoincrement())
     userId    String
     fact      String
     createdAt DateTime @default(now())
     user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
     @@unique([userId, fact])
     @@index([userId])
   }
   ```
3. `User` model — thêm 2 quan hệ: `triviaWins TriviaWin[]` và `memberFacts MemberFact[]`.
4. Chạy migration local, xác nhận `prisma generate` sinh client mới.
5. `tsc` để chắc config type đúng.

## Todo

- [ ] Thêm `config.trivia` + `config.memory`
- [ ] Thêm model `TriviaWin`, `MemberFact` + quan hệ `User`
- [ ] Chạy migration `trivia_and_member_fact`
- [ ] `tsc` exit 0

## Success Criteria

- [ ] `config.trivia.channelId` và `config.memory.enabled` truy cập được, đúng type
- [ ] Migration tạo 2 bảng, không đụng bảng cũ
- [ ] `npx prisma generate` xong, `tsc` exit 0

## Risk Assessment

- **Migration trên host**: host dùng `db:migrate` (deploy) — cần commit thư mục `prisma/migrations/`. Đảm bảo migration đã tạo local trước khi push. Rollback: migration chỉ thêm bảng, drop 2 bảng mới là hoàn tác sạch.
