---
name: newspaper-front-page-and-weekly-digest
created: 2026-08-03T13:01:42Z
updated: 2026-08-03T13:01:42Z
---

# Trang nhất tờ báo + số đặc biệt tuần

**Date**: 2026-08-03 13:01 UTC
**Severity**: Medium
**Component**: report system (nhật báo / weekly digest / canvas render)
**Status**: Resolved (commit `4c35f30`, 41 files, build sạch, self-check 75 assertions)

## What Happened

Bản tin 21h giờ đăng kèm ảnh tờ báo 1200x900 (@napi-rs/canvas): măng-sét "BÁO STELLA", headline AI trích cap 60 ký tự, sapo, ô ảnh minh hoạ, lưới 2-4 chuyên mục AI tự chọn. Chủ nhật thêm bài "SỐ ĐẶC BIỆT — TUẦN VỪA QUA": đọc lại bài ngày từ bảng `ReportDaily` mới (migration `20260803190000_report_daily`, retention 35 ngày), 1 lượt AI gộp, thread riêng + ảnh măng-sét đỏ.

## Quyết định

- **Không đụng prompt composer**: đã tinh chỉnh nhiều vòng, nên trang nhất là **lượt AI riêng** đọc body đã gộp, không nhồi thêm yêu cầu vào lượt cũ.
- **Bảng ReportDaily riêng** thay vì tái dùng chunk 3h: chunk prune sau 7 ngày và không phải bài hoàn chỉnh — muốn digest tuần thì phải lưu bài đã đăng.
- **Chữ Việt do canvas vẽ, không để AI image render chữ** (AI sai dấu). Font Noto Serif/Sans nhúng vào `src/assets/fonts/` (OFL) vì host Linux shared không có font tiếng Việt hệ thống — nghĩa là `cardRenderer` cũ (dùng font tên hệ thống) có thể đã hỏng dấu từ trước và chưa ai để ý.
- **imagePrompt bắt buộc tiếng Anh + cấm tên người thật**: không gửi tên member sang image provider.
- Weekly trigger nằm trong tick nhật báo, claim `report-weekly` qua `MaintenanceLog` chống trùng — không thêm timer mới. Chạy cả khi bản tin CN 'empty' nếu tuần có ≥3 ngày dữ liệu.

## The Brutal Truth

Con bug đáng sợ nhất không phải bug crash, mà là `isSundaySaigon` **thiếu `timeZone`**. Trên host ≥UTC+10 bài tuần sẽ chết im lặng — không log, không lỗi, chỉ là chủ nhật không bao giờ tồn tại theo giờ máy. Nếu code-review không bắt, ta sẽ ngồi chờ mấy tuần rồi tự hỏi "sao chưa thấy số đặc biệt". Timezone-naive `Date` trong repo có múi giờ nghiệp vụ cố định (Asia/Ho_Chi_Minh) là lỗi lặp lại, đáng grep toàn bộ.

Ba lỗi layout khác cũng do review: band chuyên mục tràn/biến mất khi headline 2 dòng (sửa: band neo đáy 130px cố định, headline shrink theo chiều cao), label dài tràn ô (shrink 1 dòng), text bị cắt câm (`wrapTextCapped` thêm `…`). Canvas không throw khi vẽ ra ngoài khung — nó chỉ lặng lẽ cho ra ảnh xấu.

## Technical Details

- Image gateway trả `503 No capacity available for gemini-3.1-flash-image` ngay lúc test. Fail-soft tự chuyển sang ô hoạ tiết pixel-art Minecraft — **đúng thiết kế**, và may là đã test đúng lúc provider hết capacity thay vì phát hiện lần đầu ở production.
- Pipeline: map-reduce 3h → 8 chunk → 1 bài 21h; nay + 1 lượt extract trang nhất + (CN) 1 lượt gộp tuần.

## Lessons Learned

1. Bất kỳ so sánh ngày/thứ theo giờ VN **phải** truyền `timeZone`. Không có `timeZone` = lỗi ngầm, không phải lỗi ồn.
2. Render canvas cần assertion về hình học (band cao bao nhiêu, text còn bao nhiêu dòng), vì lỗi vẽ không throw.
3. Font phải nhúng, không tin host có font tiếng Việt.
4. Prompt đã được tinh chỉnh thì thêm lượt AI mới rẻ hơn sửa lượt cũ.

## Next Steps

- [ ] Grep toàn repo tìm chỗ so sánh ngày/thứ thiếu `timeZone` (owner: dev chính, trước lần deploy tới).
- [ ] Kiểm tra `cardRenderer` cũ có hỏng dấu trên host không, chuyển sang font nhúng nếu có.
- [ ] Chờ chủ nhật đầu tiên (2026-08-09) xác nhận weekly digest đăng thật, có claim `report-weekly` trong `MaintenanceLog`.
- [ ] **Blocker môi trường**: ổ C: còn 0 bytes free — đang chờ user dọn trước khi làm việc nặng.
