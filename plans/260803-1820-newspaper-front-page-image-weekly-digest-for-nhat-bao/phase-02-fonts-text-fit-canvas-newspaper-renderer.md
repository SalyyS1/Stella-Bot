---
phase: 2
title: "Canvas newspaper renderer"
status: pending
priority: P1
effort: "5h"
dependencies: [1]
---

# Phase 2: Canvas newspaper renderer

## Overview

Module vẽ tờ báo từ dữ liệu trang nhất (`FrontPageData`) ra PNG. Layout báo giấy cổ:
măng-sét serif đen đậm + ngày, headline lớn, sapo, ô ảnh minh hoạ (ảnh AI hoặc ô hoạ
tiết thay thế), lưới 2-4 ô chuyên mục. Kèm `/maintenance newspaper-preview` để render
thử offline bằng dữ liệu mẫu — không cần đợi 21h.

## Requirements

- Functional:
  - `renderNewspaper(frontPage, opts): Promise<Buffer | null>` — 1200x900 (PNG),
    trả null khi font chưa đăng ký (fail mềm).
  - Layout (định vị theo hằng số, không AI):
    1. Măng-sét: "BÁO STELLA" (Noto Serif Bold ~96px) + ngày `YYYY-MM-DD` + đường
       kẻ đen dày trên/dưới.
    2. Headline: 1-2 dòng, Noto Serif Bold, thu font tới khi vừa (shrinkToFit),
       tối thiểu ~48px — dài quá thì `truncate` (cap 60 ký tự từ phase 3, đây là lưới an toàn cuối).
    3. Sapo: Noto Sans ~28px, wrap, tối đa 3 dòng, xám đen.
    4. Ô ảnh minh hoạ: tỉ lệ ~16:9 trong khung. Có ảnh → dán vào (cover, bo góc nhẹ
       bằng clip). Không có → ô hoạ tiết canvas (khối pixel Minecraft màu theo chủ đề,
       không gọi AI).
    5. Lưới chuyên mục 2-4 ô (số ô = sections.length): mỗi ô viền đen mảnh, label
       Noto Sans Bold ~30px + đường gạch chân, text 1-2 dòng ~24px, wrap.
  - `newspaper-preview`: subcommand `/maintenance newspaper-preview` đọc sample JSON
    (`scripts/sample-front-page.json` hoặc tự sinh) → render → gửi ảnh vào kênh gọi lệnh.
  - Không phụ thuộc AI: renderer thuần canvas + dữ liệu đầu vào.
- Non-functional:
  - Vẽ nhanh (< 3s mỗi ảnh), không block event loop quá lâu (canvas native nên OK).
  - Mỗi file < 200 dòng — tách layout hằng số + hàm vẽ theo vùng nếu cần.

## Architecture

```
FrontPageData (interface, định nghĩa ở đây để phase 3 dùng chung):
  { date: string, headline: string, sapo: string,
    sections: Array<{ label: string, text: string }>,
    illustration?: Buffer | null }

src/systems/report/newspaper/newspaper-canvas.ts
  renderNewspaper(frontPage, opts?) -> Promise<Buffer | null>
  - helper vẽ: drawMasthead / drawHeadline / drawSapo / drawIllustration / drawSections
src/systems/report/newspaper/newspaper-layout.ts   (hằng số toạ độ, palette giấy ố)
src/commands/maintenance.ts                          (thêm subcommand preview)
scripts/sample-front-page.json                        (dữ liệu mẫu cho preview)
```

## Related Code Files

- Create: `src/systems/report/newspaper/newspaper-canvas.ts`
- Create: `src/systems/report/newspaper/newspaper-layout.ts`
- Create: `scripts/sample-front-page.json`
- Modify: `src/commands/maintenance.ts` (subcommand `newspaper-preview`)

## Implementation Steps

1. Định nghĩa `FrontPageData` + hằng số layout trong `newspaper-layout.ts`
   (kích thước 1200x900, palette: giấy `#f5f0e6`, mực `#1a1a1a`, đỏ nhấn `#b8232c`,
   xám `#4a4a4a`).
2. `newspaper-canvas.ts`: kiểm `registerFonts()` (gọi `GlobalFonts.has`) trước khi vẽ;
   trả null nếu thiếu. Vẽ lần lượt 5 vùng; mọi text qua `wrapText`/`shrinkToFit`/`truncate`
   từ phase 1.
3. Ô minh hoạ: `drawIllustration` — nếu `illustration` là Buffer: `loadImage` +
   cover-crop + clip bo góc. Không có: vẽ hoạ tiết khối pixel (màu ngẫu nhiên theo
   seed từ ngày để ổn định trong ngày, trông không lặp y hệt mỗi ngày).
4. Thêm subcommand `newspaper-preview` vào `maintenance.ts` (pattern subcommand
   `report` có sẵn: defer → render → reply ảnh; ép kiểu ephemeral? — theo kiểu các
   subcommand maintenance khác, dùng deferred reply bình thường).
5. Chạy preview bằng tay: `node scripts/render-newspaper-preview.cjs` (script nhỏ
   tự build sample → ghi `tmp_newspaper_preview.png`) — **xem ảnh bằng mắt**: dấu
   tiếng Việt chuẩn, không tràn, 2-4 ô cân đối. (tmp_*.png nằm trong .gitignore.)
6. `npm run build` sạch.

## Success Criteria

- [x] Render sample JSON → PNG nhìn đẹp: măng-sét, headline đúng dấu tiếng Việt, 4 ô cân đối
- [x] Headline 120 ký tự (quá cap): bị `truncate` + thu font, không tràn khung
- [x] Không có ảnh minh hoạ: ô hoạ tiết vẽ được, ảnh vẫn ra
- [x] Font chưa đăng ký (mô phỏng): trả null, không throw
- [x] `/maintenance newspaper-preview` gửi được ảnh vào kênh
- [x] `npm run build` sạch

## Risk Assessment

- **Text tràn dù đã cap**: cap 60 ký tự headline là xa dưới khả năng 1 dòng 900px ở
  48px (≈ 30 ký tự/dòng × 2 dòng) — 60 ký tự 2 dòng 48px ≈ vừa khít 1000px; shrinkToFit
  xuống tối thiểu 40px là dư đủ. Vẫn test trường hợp 60 ký tự toàn chữ hoa W.
- **Font không có trên host**: renderer trả null → publisher bỏ ảnh, đăng text-only
  (phase 3 xử lý). Không crash.
- **Số ô chuyên mục 0 hay 5+** (AI phá format): renderer tự co — 0 ô thì bỏ hẳn lưới,
  > 4 thì vẽ 2 hàng (2+2), không vẽ ngoài canvas.
