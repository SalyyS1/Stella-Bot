---
phase: 1
title: "Fonts, text-fit & config"
status: pending
priority: P1
effort: "3h"
dependencies: []
---

# Phase 1: Fonts, text-fit & config

## Overview

Nền móng cho tờ báo: nhúng font tiếng Việt vào repo (host Linux shared không có font
hệ thống → chữ Việt ra ô vuông), helper wrap/thu chữ theo `measureText` (canvas không
tự xuống dòng — không tin prompt), và khai config `report.newspaper`.

## Requirements

- Functional:
  - Font Noto Serif (Regular + Bold) + Noto Sans (Regular + Bold), 4 file `.ttf`,
    commit trong repo tại `src/assets/fonts/` (license OFL — kèm file `OFL.txt`).
  - `registerFonts()` đăng ký qua `GlobalFonts.registerFromPath` khi bot khởi động
    (gọi từ `src/events/ready.ts`), fail mềm: thiếu font thì log 1 dòng, không chết bot.
  - `newspaper-text-fit.ts`: `wrapText(ctx, text, maxWidth)` xuống dòng theo từ,
    `shrinkToFit(ctx, text, maxWidth, startSize, minSize)` thu nhỏ font tới khi vừa,
    `truncate(text, maxChars)` cắt chuẩn độ dài (đếm theo ký tự, không theo byte).
  - Config: `report.newspaper = { enabled, width: 1200, height: 900, extractMaxTokens, extractTimeoutMs, illustration: { enabled } }`.
- Non-functional:
  - Không thêm dependency mới (font file là asset, không phải package).
  - Script tải font (`scripts/download-newspaper-fonts.cjs`) chỉ dùng để tái lập —
    file `.ttf` vẫn phải commit, host không cần internet lúc build.

## Architecture

```
src/assets/fonts/NotoSerif-Regular.ttf  (+ Bold, NotoSans Regular/Bold, OFL.txt)
src/systems/report/newspaper/newspaper-fonts.ts    registerFonts() -> boolean
src/systems/report/newspaper/newspaper-text-fit.ts wrapText / shrinkToFit / truncate
src/config.ts → report.newspaper
src/events/ready.ts → registerFonts() (1 dòng, best-effort)
```

Font-family sau khi đăng ký: `"Noto Serif"`, `"Noto Sans"` — renderer dùng tên này.

## Related Code Files

- Create: `src/assets/fonts/*.ttf` + `OFL.txt`
- Create: `src/systems/report/newspaper/newspaper-fonts.ts`
- Create: `src/systems/report/newspaper/newspaper-text-fit.ts`
- Create: `scripts/download-newspaper-fonts.cjs` (tái lập, không chạy khi build)
- Modify: `src/config.ts` (khối `report.newspaper`)
- Modify: `src/events/ready.ts` (gọi `registerFonts()`)

## Implementation Steps

1. Download font: **cả static + variable** (chốt Validation S1).
   - Static: zip từ `https://fonts.google.com/download?family=Noto%20Serif` và
     `...Noto%20Sans` (chứa `NotoSerif-Bold.ttf`, `NotoSerif-Regular.ttf`,
     `NotoSans-Bold.ttf`, `NotoSans-Regular.ttf`) — **đây là nguồn chính**.
   - Variable (dự phòng): `NotoSerif[wdth,wght].ttf`, `NotoSans[wdth,wght].ttf` từ
     repo `google/fonts` (`ofl/notoserif`, `ofl/notosans`).
   → commit 6 file + `OFL.txt` vào `src/assets/fonts/`.
2. `newspaper-fonts.ts`: `export function registerFonts(): boolean` — gọi
   `GlobalFonts.registerFromPath` cho 4 file **static trước**; nếu file static thiếu,
   thử variable (weight mặc định); trả true khi đăng ký được ≥1 bộ Serif + 1 bộ Sans.
   Log rõ file nào thiếu.
3. `newspaper-text-fit.ts`: implement 3 helper thuần (không phụ thuộc canvas ngoài
   tham số ctx truyền vào — dễ test). `truncate` xử lý cả chuỗi rỗng/null.
4. Config: thêm `report.newspaper` với giá trị mặc định như trên (extract sau khi
   đo được thực tế, xem config cũ để khớp style chú thích tiếng Việt).
5. `ready.ts`: gọi `registerFonts()` trong try/catch, log `[report] fonts ...` theo
   mẫu `logReport` của scheduler.
6. `npm run build` → sạch. `npm test` → xanh.

## Success Criteria

- [x] `npm run build` sạch (tsc exit 0)
- [x] 6 file .ttf + OFL.txt có trong git (tracked)
- [x] Test tay: script node nhỏ gọi `registerFonts()` rồi `GlobalFonts.families` thấy "Noto Serif" và "Noto Sans" (từ bộ static; fallback variable khi thiếu static)
- [x] `wrapText`/`shrinkToFit`/`truncate` pass test nhanh: chuỗi dài 300 ký tự tiếng Việt wrap đúng, không tràn width cho trước
- [x] Config mới đọc được từ `config.report.newspaper`

## Risk Assessment

- **Font thuộc bản quyền?** Noto = OFL, commit thoải mái. Ghi nguồn trong `OFL.txt`.
- **Host thiếu file font** (deploy quên assets): `registerFonts` fail mềm, renderer
  phải tự kiểm và bỏ qua ảnh (đăng text-only) — không crash bot. Thêm assert trong
  phase 2 rằng renderer không gọi khi font thiếu.
- **`download-newspaper-fonts.cjs` hỏng mạng** (Google bị chặn ở host): script chỉ
  chạy máy dev; file đã commit nên host không cần.
- **Variable font làm weight không áp dụng** (nếu static thiếu và phải fallback):
  variable `[wdth,wght]` khi đăng ký qua `registerFromPath` có thể chỉ hiện weight
  mặc định; renderer vẫn hoạt động (chữ đúng dấu) — chỉ bớt đậm nhạt, chấp nhận được
  cho đường dự phòng.

<!-- Updated: Validation Session 1 - nguồn font: static + variable, static ưu tiên -->
