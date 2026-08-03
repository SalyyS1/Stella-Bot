---
title: "Newspaper front-page image & weekly digest for nhat bao"
description: "Nhật báo thêm ảnh tờ báo (canvas + ảnh minh hoạ AI) và bài TỔNG HỢP TUẦN VỪA QUA chủ nhật"
status: completed
priority: P1
effort: "2d"
tags: [report, canvas, image-gen, weekly]
created: 2026-08-03
blockedBy: []
---

# Newspaper front-page image & weekly digest for nhat bao

Status: **5/5 phases xong, build sạch, self-check 75 assertions pass, code-review DONE (5 major + 6 minor đã sửa và verify).**

## Overview

Nâng cấp nhật báo theo thiết kế đã duyệt:
`plans/reports/brainstorm-260803-1819-newspaper-image-and-weekly-digest-report.md`

1. Mỗi tối, sau khi gộp bản tin chữ (embed hiện tại GIỮ NGUYÊN), thêm **1 tấm ảnh tờ báo**
   đăng kèm: măng-sét "BÁO STELLA" + ngày, headline giật gân, sapo, 2-4 ô chuyên mục
   (Drama/Kiến thức/Phiếm/Khoe hàng... — AI tự chọn theo ngày). Chữ do canvas vẽ
   (tiếng Việt chuẩn nhờ font nhúng), ảnh minh hoạ do AI gen (fail-soft).
2. **Chủ nhật**, trong tick nhật báo sau khi `runReport` xử lý xong (bản tin CN đăng
   hay 'empty' đều được), đọc các bài trong tuần (bảng `ReportDaily` mới, cần ≥3 ngày)
   → đăng "**SỐ ĐẶC BIỆT — TUẦN VỪA QUA**" + ảnh riêng vào cùng forum.

Không đụng prompt composer hiện tại, không đụng pipeline chunk 3h, không đổi nội dung
embed chữ. Mọi bước mới fail-soft: lỗi chỉ làm mất ảnh/bài phụ, không bao giờ mất bản tin.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Tờ báo canvas render tiếng Việt chuẩn (font nhúng), layout báo giấy cổ, 1200x900 | P1 |
| 2 | Lượt AI trích trang nhất từ body + ảnh minh hoạ AI, nối vào postReport fail-soft | P1 |
| 3 | Lưu bài ngày vào bảng `ReportDaily` sau khi đăng (nguồn cho bài tuần) | P1 |
| 4 | Bài TỔNG HỢP TUẦN chủ nhật, chống trùng qua claim `report-weekly` | P2 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Fonts, text-fit & config](./phase-01-start.md) | Pending |
| 2 | [Canvas newspaper renderer](./phase-02-fonts-text-fit-canvas-newspaper-renderer.md) | Pending |
| 3 | [Front-page extract + wire into publisher](./phase-03-front-page-extract-wire-into-publisher.md) | Pending |
| 4 | [ReportDaily table + save on post](./phase-04-reportdaily-table-save-on-post.md) | Pending |
| 5 | [Weekly digest (Chủ nhật)](./phase-05-weekly-digest-ch-nht.md) | Pending |

## Dependencies

- Phase 3 cần phase 2 (renderer). Phase 2 cần phase 1 (font + text-fit).
- Phase 4 độc lập với 1-3 (chỉ chạm scheduler + prisma) — có thể làm sớm để tích dữ liệu.
- Phase 5 cần phase 4 (dữ liệu) + phase 2 (ảnh tuần).
- Không bị chặn bởi plan cũ: `plans/260728-2159-...` (nhật báo map-reduce) đã xong.

## Success Criteria

- [ ] Ngày bất kỳ: forum có embed chữ cũ + 1 ảnh báo, headline đúng dấu tiếng Việt, 2-4 mục hợp ngày
- [ ] Thiếu `IMAGE_API_KEY` / image gen chết: vẫn đăng bản tin chữ + ảnh canvas có ô minh hoạ thay thế
- [ ] Lượt AI extract lỗi: đăng bản tin chữ như hiện tại (không mất bản tin)
- [ ] Chủ nhật: đăng thêm bài "SỐ ĐẶC BIỆT — TUẦN VỪA QUA" tổng hợp các bài ngày trong tuần (≥3 ngày dữ liệu, kể cả khi bản tin CN hôm đó 'empty')
- [ ] Chạy lại / restart giữa chừng: không đăng trùng ngày, không đăng trùng tuần (claim hoạt động)
- [ ] `npm run build` sạch; `npm test` (self-check) xanh

## Validation Log

### Verification Results (2026-08-03)
- Claims checked: 6 | Verified: 5 | Failed: 1 | Unverified: 0
- Tier: Standard
- Failures:
  - `phase-01` — nguồn tải font: google/fonts GitHub chỉ có **variable font**
    (`NotoSerif[wdth,wght].ttf`, không có static Bold/Regular). Đã sửa phase 1.

### Validation Session 1 — quyết định đã chốt
| Câu hỏi | Quyết định |
|---|---|
| Nguồn font static | **Commit cả 2**: static TTF (từ zip fonts.google.com/download) + variable font (từ repo). Static ưu tiên đăng ký, variable dự phòng. Script download lấy cả hai |
| Bài tuần khi nhật báo CN 'empty' | **Đủ ≥3 ngày là chạy** — không đòi hỏi bản tin CN posted. Trigger: hôm nay CN + kết thúc runReport (outcome bất kỳ trừ 'disabled') → runWeeklyDigest; claim `report-weekly` lo chống trùng |
| Kênh đăng bài tuần | **Cùng forum nhật báo** (`config.report.forumChannel`) — không thêm config |

### Whole-Plan Consistency Sweep
- Phase 1: sửa nguồn font (static + variable, 6 file).
- Phase 5: bỏ điều kiện `posted` trong trigger; bổ sung ghi chú "CN empty vẫn chạy digest nếu đủ ngày".
- Không còn mâu thuẫn mở.

<!-- slug: newspaper-front-page-image-weekly-digest-for-nhat-bao -->
