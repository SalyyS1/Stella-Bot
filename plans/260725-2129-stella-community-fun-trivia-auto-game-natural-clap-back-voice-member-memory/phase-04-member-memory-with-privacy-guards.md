---
phase: 4
title: "Member memory with privacy guards"
status: pending
priority: P3
effort: "2-3d"
dependencies: [1, 2]
---

# Phase 4: Member memory với privacy guards

## Overview

Stella nhớ vài "fact" ngắn về thành viên từ chat công khai (vd "thích xây nhà gỗ") rồi cá-nhân-hoá câu trả lời / chọc yêu. Đây là phần RỦI RO CAO NHẤT — làm cuối cùng, có phanh cứng: vùng cấm, chỉ chọc người đang nói chuyện, lệnh tự xoá. Bật/tắt riêng qua config để có thể tắt nếu quá tay.

## Requirements

- Functional: rút tối đa N fact ngắn/người từ chat công khai (không tin nhắn riêng).
- Functional: nạp fact của người hỏi vào context Q&A để Stella cá-nhân-hoá.
- Functional: `/stella biết gì` (xem fact về mình), `/stella quên tôi` (xoá sạch fact về mình).
- Non-functional (PRIVACY — bắt buộc):
  - Vùng cấm cứng: KHÔNG lưu/không dùng chuyện tình cảm nghiêm túc, drama/xích mích, thông tin nhạy cảm (tuổi thật, địa chỉ, phốt, danh tính thật).
  - Chỉ chọc CHÍNH người đang nói chuyện; KHÔNG réo người vắng mặt (khác ví dụ user — tránh drama thật).
  - Feature gate `config.ai.memory.enabled` để tắt nhanh toàn bộ.

## Key Insights

- Q&A đã có memory hội thoại ngắn hạn (RAM, 6 lượt) trong `aiQaManager.ts`. Fact dài hạn là lớp KHÁC (bền, Prisma), đừng trộn.
- Rút fact rẻ: sau khi Stella trả lời, gọi `askAI` lần 2 với prompt "rút tối đa 1 fact đáng nhớ, an toàn, hoặc trả 'NONE'". Không cần vector DB.
- Chống bơm fact rác/nhạy cảm: prompt rút fact có vùng cấm + validate độ dài; cap số fact/người (ghi đè cũ nhất khi đầy).

## Architecture

- Prisma model `MemberFact` (đã thêm ở Phase 1): `id, userId, fact, createdAt`. Index `userId`. Cap ví dụ 8 fact/người (xoá cũ nhất khi vượt).
- `src/systems/member-memory-manager.ts`:
  - `extractFact(userId, question, answer)`: gọi `askAI` với system prompt "rút 1 fact ngắn AN TOÀN về người dùng từ đoạn chat công khai này; TUYỆT ĐỐI bỏ qua chuyện tình cảm/drama/nhạy cảm/danh tính thật; nếu không có gì đáng nhớ và an toàn → trả đúng chữ NONE". Nếu != NONE và độ dài hợp lệ → lưu (cap 8, xoá cũ nhất).
  - `getFacts(userId)`: đọc fact để nạp context.
  - `forgetUser(userId)`: xoá sạch fact của user.
- Nối vào `aiQaManager.answerQuestion`:
  - Trước khi gọi AI: nạp `getFacts(userId)` vào 1 system message `<MEMORY>…</MEMORY>` (kèm chỉ dẫn: chỉ dùng để cá-nhân-hoá/chọc CHÍNH người này, không réo người khác).
  - Sau khi trả lời xong (trong nhánh thành công): `extractFact(...)` chạy nền `.catch(()=>{})`, không block reply.
- `/stella` command (`src/commands/stella.ts`) với subcommand `biết-gì` và `quên-tôi` (hoặc 2 lệnh riêng nếu builder gọn hơn).
- SYSTEM_PROMPT (Phase 2) bổ sung 1 đoạn: có thể dùng khối `<MEMORY>` để chọc yêu CHÍNH người đang hỏi; tuyệt đối không bịa fact, không réo người vắng mặt, không đụng vùng cấm.

## Related Code Files

- Modify: `prisma/schema.prisma` — model `MemberFact` (thực ra thêm ở Phase 1; đây dùng lại).
- Create: `src/systems/member-memory-manager.ts` — extract/get/forget + vùng cấm.
- Create: `src/commands/stella.ts` — `/stella biết-gì`, `/stella quên-tôi`.
- Modify: `src/systems/aiQaManager.ts` — nạp `<MEMORY>` vào context + gọi `extractFact` nền.
- Modify: `src/config.ts` — `ai.memory: { enabled, maxFactsPerUser: 8, maxFactLen: 120 }`.

## Implementation Steps

1. Xác nhận `MemberFact` có trong schema (Phase 1). `npx prisma generate` + `db push`.
2. `config.ai.memory` block với `enabled` (mặc định true, tắt được).
3. `member-memory-manager.ts`:
   - `extractFact`: guard `if (!config.ai.memory.enabled) return;`. Gọi `askAI` prompt vùng-cấm. Validate: != 'NONE', trim, len ≤ maxFactLen. Lưu; nếu > maxFactsPerUser → xoá fact cũ nhất.
   - `getFacts`: trả mảng string.
   - `forgetUser`: `deleteMany({ where: { userId } })`.
4. `aiQaManager.ts`:
   - Trong `answerQuestion`, nếu `config.ai.memory.enabled`: `const facts = await getFacts(userId)` → nếu có, push system `<MEMORY>` (kèm rule chỉ chọc chính người này).
   - Sau `recordTurn`: `extractFact(userId, question, answer).catch(()=>{})` (không await block reply — nhưng slot đã release ở finally, nên chạy nền OK).
5. `stella.ts`: `/stella biết-gì` → list fact (ephemeral); `/stella quên-tôi` → `forgetUser` + xác nhận. Command tự sync qua loader.
6. Cập nhật SYSTEM_PROMPT (Phase 2) thêm đoạn dùng `<MEMORY>`.
7. `tsc` exit 0.

## Todo

- [ ] `config.ai.memory` block (enabled gate)
- [ ] `MemberFact` generate + db push
- [ ] `member-memory-manager.ts` (extract vùng-cấm / get / forget)
- [ ] Nối `<MEMORY>` context + `extractFact` nền vào `aiQaManager.ts`
- [ ] `/stella biết-gì` + `/stella quên-tôi`
- [ ] SYSTEM_PROMPT thêm rule dùng MEMORY (chỉ chọc chính chủ)
- [ ] `tsc` exit 0

## Success Criteria

- [ ] Stella cá-nhân-hoá/chọc yêu dựa trên fact CHÍNH người đang hỏi (đọc thử vài lượt)
- [ ] `/stella quên-tôi` xoá sạch fact người gọi (query DB = 0 dòng sau khi chạy)
- [ ] `/stella biết-gì` liệt kê đúng fact đang lưu (ephemeral)
- [ ] KHÔNG lưu fact thuộc vùng cấm (thử kể chuyện tình cảm/drama → không tạo fact)
- [ ] Stella KHÔNG réo tên người vắng mặt trong câu chọc (theo dõi vài ngày)
- [ ] Tắt `config.ai.memory.enabled` → không nạp, không rút fact

## Risk Assessment

- **Phơi bày chuyện riêng / khịa nhầm** (rủi ro cao nhất): vùng cấm trong prompt rút fact + rule "chỉ chọc chính chủ" trong SYSTEM_PROMPT + lệnh quên. Vẫn có thể lọt — cần user quan sát vài hôm, tắt gate nếu quá tay.
- **Model rút fact sai/nhạy cảm**: validate + vùng cấm; chấp nhận sót nhỏ; gate tắt được.
- **Chi phí AI x2/lượt** (thêm 1 call rút fact): chạy nền, không block; nếu tốn thì hạ tần suất (vd chỉ rút 1/N lượt). Ghi nhận, chưa tối ưu sớm (YAGNI).
- **Fact tích luỹ rác**: cap 8/người + ghi đè cũ nhất.
- **Consent**: chỉ chat công khai + lệnh quên minh bạch. Đây là ranh giới đã chốt với user.
