---
name: brainstorm-newspaper-image-and-weekly-digest
status: agreed
created: 2026-08-03T11:19:27Z
updated: 2026-08-03T11:19:27Z
---

# Brainstorm: Ảnh tờ báo cho nhật báo + Bài tổng hợp tuần

## Problem statement

Nhật báo hiện chỉ là embed chữ vàng. Muốn:
1. Thêm 1 tấm ảnh mô phỏng tờ báo đăng kèm — kiểu tiêu đề giật gân/tin hot, chia mảng (kiến thức, phiếm, drama, etc.).
2. Chủ nhật sau khi đăng nhật báo CN, tự đọc lại bài cả tuần → đăng bài "TỔNG HỢP TUẦN VỪA QUA".
3. Nội dung embed chữ GIỮ NGUYÊN như hiện tại.

## Scout findings (ràng buộc từ codebase)

- Nhật báo = map-reduce 2 tầng: chunk 3h → `ReportChunk` DB → 21h gộp → embed vào forum. Scheduler 1 timer 15 phút (`src/systems/report/report-scheduler.ts`).
- **Bài ngày không được lưu đâu cả** — post xong là mất ⇒ bài tuần bắt buộc thêm bảng DB.
- `@napi-rs/canvas` đã là dependency (4 nơi dùng), có `GlobalFonts.registerFromPath` ⇒ nhúng font được.
- `imageGenClient.ts` chạy sẵn (`IMAGE_API_KEY` đã set), trả Buffer sẵn attach.
- `scripts/prepare-host-package.js` copy `src/assets` → host ⇒ bỏ font vào đó tự lên host.
- Chốt chống trùng: `MaintenanceLog [channelId, kind, period]`.
- `weekly-reward-manager.ts` có `weekKeyFor()` (thứ 2, timezone-safe) — tái dùng cho khoá tuần.

## Quyết định đã chốt (qua hỏi đáp)

| Chủ đề | Chốt |
|---|---|
| Render ảnh | Canvas vẽ khung + chữ + **1 ảnh minh hoạ do AI gen** dán vào ô bìa. Tuyệt đối KHÔNG để AI image render chữ Việt |
| Nội dung ảnh | "Trang nhất tóm gọn": măng-sét + ngày, 1 headline lớn + sapo 2-3 câu, 2-4 ô chuyên mục mỗi ô 1 dòng |
| Chuyên mục | Danh sách gợi ý (Drama, Kiến thức, Phiếm, Khoe hàng, Người mới, Sự kiện...), AI tự chọn theo ngày, bỏ mục rỗng |
| Bài tuần | Bảng `ReportDaily` mới (period + body). CN sau khi đăng bài ngày → đọc 7 row → 1 lượt AI → đăng "SỐ ĐẶC BIỆT" + ảnh riêng |
| Ảnh minh hoạ | Có, mỗi ngày 1 lượt; fail → canvas tự vẽ ô trang trí thay thế |
| Phong cách | Báo giấy cổ: nền giấy ngà ố, măng-sét serif đen đậm, đường kẻ ngăn cột |

## Kiến trúc

### A. Ảnh trang nhất (mỗi ngày)

```
composeDailyReport (GIỮ NGUYÊN)
   ↓ body
extractFrontPage()        ← lượt AI mới, NHỎ, input = body, output = JSON
   ↓ {headline, sapo, sections[], imagePrompt}
   ├─ generateImage(imagePrompt)  ← fail-soft
   └─ renderNewspaper()           ← canvas
   ↓ PNG Buffer
postReport()  → embed cũ + setImage(attachment)
```

Module mới `src/systems/report/newspaper/` (mỗi file < 200 dòng):
- `newspaper-extract.ts` — lượt AI trích JSON, cap độ dài
- `newspaper-canvas.ts` — layout báo giấy cổ
- `newspaper-text-fit.ts` — wrap chữ + thu font theo `measureText` (không tin prompt)
- `newspaper-fonts.ts` — `GlobalFonts.register` lúc bot khởi động
- `src/assets/fonts/*.ttf` — Noto Serif + Noto Sans (OFL, commit thoải mái)

**Cap cứng trong code**: headline ≤ 60 ký tự (thu font nếu tràn), sapo ≤ 180, sections 2-4 ô (`label` ≤ 14, `text` ≤ 100), imagePrompt ≤ 300, **bắt buộc tiếng Anh + cấm tên member** (không gửi tên người thật sang provider ảnh).

**Fail-soft từng tầng**: extract lỗi → bản tin chữ như hiện tại; ảnh AI lỗi → ô hoạ tiết canvas. Không nhánh nào làm mất bản tin.

### B. Bài tuần (Chủ nhật)

```prisma
model ReportDaily {
  id        Int      @id @default(autoincrement())
  period    String   @unique
  body      String
  createdAt DateTime @default(now())
}
```

- `runReport` lưu row sau khi `postReport` OK (cạnh chỗ `pruneOldChunks`). Prune 35 ngày.
- `report/report-weekly.ts`: `runWeekly()` — claim `kind='report-weekly'`, period = ngày thứ Hai (tái dùng `weekKeyFor`).
- Kích hoạt trong **cùng tick** ngay sau `runReport` trả `'posted'` + hôm nay là CN — không thêm timer riêng, bài tuần đọc được cả bài CN.
- Cần ≥ 3 row mới chạy; đăng "**SỐ ĐẶC BIỆT — TUẦN VỪA QUA**" + ảnh riêng (măng-sét đổi màu).
- "Tuần" = CN 21:00 → CN 21:00, khớp cửa sổ nhật báo.

### C. Config

```js
report.newspaper = { enabled, extractMaxTokens, illustration: { enabled }, width: 1200, height: 900 }
report.weekly    = { enabled, minDays: 3, maxTokens, timeoutMs }
```

## Rủi ro + giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Font tiếng Việt host Linux → tofu | Nhúng .ttf vào repo (không dựa font hệ thống). Phụ: `cardRenderer` đang dùng font tên hệ thống — có thể đã hỏng sẵn, sẽ vá cùng đợt |
| Canvas không tự xuống dòng | Cap cứng + `measureText` wrap/thu font trong code |
| Lượt AI extract làm hỏng giọng bản tin | KHÔNG đụng prompt composer; lượt riêng đọc body đã xong |
| Tên member sang provider ảnh | Prompt ảnh cấm tên, bắt buộc tiếng Anh |
| Chủ nhật thiếu dữ liệu tuần | Ngưỡng ≥ 3 ngày, thiếu thì bỏ qua |

## Chi phí thêm

- Mỗi ngày: +1 lượt AI text nhỏ + 1 lượt image gen (fail-soft).
- Chủ nhật: +1 text + 1 ảnh nữa.

## Thứ tự thực hiện

| Phase | Nội dung | Vì sao |
|---|---|---|
| 1 | Font + text-fit + canvas renderer | Test offline, không tốn token, xem PNG bằng mắt. Phần dễ xấu nhất chốt trước |
| 2 | Lượt AI extract + nối publisher | Ghép vào đường thật |
| 3 | Bảng `ReportDaily` + lưu khi đăng | Tích dữ liệu cho bài tuần |
| 4 | Bài tuần | Cần ≥ 3 ngày dữ liệu từ phase 3 |

Thêm `/maintenance newspaper-preview` (phase 1-2) để render thử mọi lúc, không phải đợi 21h.

## Ngoài phạm vi

- Không đụng prompt composer / pipeline chunk / nội dung embed chữ.
- Không đổi format đăng bài hiện tại.

## Tiêu chí nghiệm thu

- Ngày bất kỳ: forum có embed cũ + 1 ảnh báo (headline có dấu tiếng Việt đúng, 2-4 mục hợp ngày).
- AI image chết / thiếu key: vẫn đăng bản tin chữ + ảnh canvas.
- CN: có thêm bài "SỐ ĐẶC BIỆT" tổng hợp 7 ngày.
- Chạy lại 2 lần cùng ngày: không đăng trùng (claim hoạt động).

## Unresolved questions

- Không còn câu hỏi mở. (Font .ttf cụ thể chọn lúc implement; kích thước ảnh 1200x900 có thể chỉnh sau khi xem bản preview.)

## Next steps

- Tạo implementation plan (engineer plan skill) với report này làm context.
