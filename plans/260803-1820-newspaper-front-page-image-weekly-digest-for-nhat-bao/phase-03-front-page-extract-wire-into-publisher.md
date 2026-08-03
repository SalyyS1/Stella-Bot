---
phase: 3
title: "Front-page extract + wire into publisher"
status: pending
priority: P1
effort: "4h"
dependencies: [2]
---

# Phase 3: Front-page extract + wire into publisher

## Overview

Lượt AI riêng đọc bản tin ngày (body đã gộp xong) → trích JSON trang nhất
(headline, sapo, sections, imagePrompt) → gọi image gen (fail-soft) → render canvas →
gắn ảnh vào embed khi đăng. KHÔNG đụng prompt composer hiện tại. Mọi tầng fail-soft:
lỗi ở đâu thì bản tin vẫn đăng như cũ (chỉ thiếu ảnh).

## Requirements

- Functional:
  - `extractFrontPage(body, date): Promise<FrontPageData | null>` — 1 lượt AI
    (`askAI`, `temperature: 0`), system prompt ngắn bảo model:
    - Đọc kỹ bản tin; headline = chuyện đáng kể nhất, giật gân nhưng TRUNG THỰC
      (không bịa, không phóng đại thành tin không có).
    - Chọn 2-4 chuyên mục từ danh sách gợi ý (Drama, Kiến thức, Phiếm, Khoe hàng,
      Người mới, Sự kiện server, Dịch vụ, Tâm sự...) — bỏ mục rỗng, có thể dùng tên khác.
    - Mỗi ô: label ≤ 14 ký tự, text ≤ 100 ký tự, viết câu ngắn kể chuyện.
    - `imagePrompt` ≤ 300 ký tự, **bắt buộc tiếng Anh**, MIÊU TẢ CẢNH/CHỦ ĐỀ trừu
      tượng (Minecraft vibe), TUYỆT ĐỐI không tên người thật, không chữ trong ảnh.
    - Trả về JSON thuần (dạng `{...}`), không markdown fence. Mọi trường string bắt
      buộc (không null).
  - JSON parsing: bọc `extractJson`-style (tương tự `reminder-parser.ts`), validate
    số lượng section trong [1,4], trim + cap cứng bằng `truncate` từ phase 1.
  - `buildFrontPageImage(body, date): Promise<Buffer | null>` — phối hợp:
    1. `extractFrontPage` fail → trả null (publisher bỏ ảnh).
    2. `config.report.newspaper.illustration.enabled` + `generateImage(imagePrompt)`
       (có sẵn `imageGenClient`) — fail → `illustration = null` (canvas vẽ ô thay thế).
    3. `renderNewspaper(data)` — null → null.
  - `postReport(client, period, body, image?: Buffer)` — khi có image: thêm
    `AttachmentBuilder` + `embed.setImage('attachment://newspaper.png')`.
  - Scheduler `runReport`: sau khi `body` compose xong, gọi `buildFrontPageImage`
    trong try/catch; truyền kết quả vào `postReport`.
- Non-functional:
  - Toàn bộ bước ảnh nằm NGOÀI quyết định `posted` — post thất bại vẫn xử lý như cũ.
  - Không tăng timeout của `composeDailyReport`; lượt extract/image có timeout riêng
    (config), tổng thời gian thêm ~1-2 phút tối đa, chạy song song với việc khác
    không cần thiết — chạy tuần tự ngay sau compose, trước post.

## Architecture

```
runReport (report-scheduler.ts)
  body = await composeDailyReport(...)          // KHÔNG đổi
  image = await buildFrontPageImage(body, period).catch(() => null)   // MỚI
  posted = await postReport(client, period, body, image ?? undefined)

src/systems/report/newspaper/newspaper-extract.ts
  extractFrontPage(body, date) -> FrontPageData | null     (askAI + JSON validate + cap)
src/systems/report/newspaper/newspaper-pipeline.ts
  buildFrontPageImage(body, date) -> Buffer | null          (extract → image → canvas)
src/systems/report/report-publisher.ts                     (đổi signature, thêm attachment)
src/systems/report/report-scheduler.ts                      (gọi pipeline trước post)
src/config.ts                                               (extractMaxTokens, extractTimeoutMs, illustration.enabled)
```

## Related Code Files

- Create: `src/systems/report/newspaper/newspaper-extract.ts`
- Create: `src/systems/report/newspaper/newspaper-pipeline.ts`
- Modify: `src/systems/report/report-publisher.ts` (param `image?`, attachment)
- Modify: `src/systems/report/report-scheduler.ts` (gọi pipeline, truyền image)
- Modify: `src/config.ts` (hoàn thiện `report.newspaper`)

## Implementation Steps

1. `newspaper-extract.ts`: viết system prompt + `extractFrontPage` (bắt buộc JSON,
   không fence). Dùng `extractJson` (copy helper 15 dòng từ reminder-parser hoặc
   trích sang util dùng chung — ưu tiên dùng chung: `src/utils/extract-json.ts`).
2. Validate + cap: sections 1-4 (0 → null, >4 → giữ 4 đầu), mọi string qua
   `truncate` (headline 60, sapo 180, label 14, text 100, imagePrompt 300). Chuẩn
   hoá imagePrompt: thêm hậu tố chuẩn bắt buộc tiếng Anh + "no text, no words, no
   letters" + "Minecraft blocky style".
3. `newspaper-pipeline.ts`: `buildFrontPageImage` theo thứ tự fail-soft; đo thời
   gian bằng `elapsed`-style và log như scheduler (1 dòng/điểm).
4. `report-publisher.ts`: thêm param image; dùng `AttachmentBuilder` từ discord.js,
   `setImage('attachment://newspaper.png')` chỉ khi có.
5. `report-scheduler.ts`: trong `runReport`, sau compose → pipeline → postReport;
   toàn bộ trong try/catch, log lỗi mà KHÔNG ảnh hưởng luồng post hiện có.
6. Config: `extractMaxTokens: 2000, extractTimeoutMs: 90_000, illustration.enabled: true`.
7. Build + test: `npm run build`, `npm test`. Chạy `/maintenance report` bản admin
   (hoặc preview) để xem ảnh thật.

## Success Criteria

- [x] Nhật báo thật (admin run) đăng kèm ảnh tờ báo đúng dấu tiếng Việt
- [x] Tắt `IMAGE_API_KEY` (mô phỏng): vẫn đăng text + ảnh canvas có ô hoạ tiết
- [x] Prompt extract trả JSON rác / null: `buildFrontPageImage` trả null, bản tin
  text vẫn đăng nguyên vẹn, không throw ra scheduler
- [x] Embed đầu tiên có image attachment; embed follow-up không đổi
- [x] `npm run build` sạch, `npm test` xanh

## Risk Assessment

- **AI trả JSON sai format**: bắt qua try/catch + validate cứng; fail → bỏ ảnh.
  Không retry (giữ chi phí thấp — 1 lượt/ngày, fail là chấp nhận được).
- **Image gen chậm > timeout**: `generateImage` có sẵn AbortController (120s);
  pipeline chỉ chờ tới đó rồi dùng ô thay thế.
- **Thời gian chạy tối muộn**: bước ảnh thêm tối đa ~2 phút sau compose; tick guard
  `running` đã chặn overlap. Nguy cơ đăng trễ qua 22h thấp (compose chiếm phần lớn
  thời gian; image gen chạy trong lúc post chỉ thêm ít). Nếu cần, sau này có thể
  giảm timeout — không cần thiết ở vòng này.
- **Prompt ảnh lộ tên member**: system prompt cấm + hậu tố chuẩn hoá; ảnh không
  phục vụ ai cụ thể nên rủi ro thấp.
