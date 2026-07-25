---
phase: 2
title: "Voice revamp: natural clap-back persona"
status: pending
priority: P1
effort: "1h"
dependencies: [1]
---

# Phase 2: Voice revamp — natural clap-back persona

## Overview

Sửa Stella trả lời cụt ngủn → tự nhiên, dài thoải mái, cà khịa mạnh có phanh, phân theo ngữ cảnh (kỹ thuật=chính xác, tán gẫu=lầy). Chỉ đụng `aiQaManager.ts` + `config.ai.temperature`. Đây là thắng nhanh nhất — làm trước, quan sát vài ngày.

## Requirements

- Functional: viết lại `SYSTEM_PROMPT` — bỏ mâu thuẫn "trả lời gọn/rõ", thêm hướng dẫn phân ngữ cảnh + cà khịa mạnh + vùng cấm.
- Functional: nâng `config.ai.temperature` 0.6 → 0.85 cho giọng tự nhiên.
- Non-functional: giữ nguyên phần bảo vệ danh tính (không lộ model) và chống tool-call XML — 2 khối này ĐÃ đúng, không xoá.

## Key Insights

- Nguyên nhân gốc câu cụt: `SYSTEM_PROMPT` hiện có câu ép *"trả lời gọn và rõ"* đá nhau với chỉ thị "lầy, cà khịa" → model chọn đường an toàn = ngắn.
- Bộ nhớ hội thoại (6 lượt, TTL 15') đã có sẵn — không cần đụng.

## Architecture

- Chỉ sửa hằng `SYSTEM_PROMPT` (string) trong `src/systems/aiQaManager.ts` và `temperature` trong `src/config.ts`.
- Cấu trúc prompt mới, giữ thứ tự: Identity+persona → **phân ngữ cảnh (mới)** → **cà khịa + vùng cấm (mới)** → bảo vệ danh tính (giữ) → xử lý ngữ cảnh hội thoại (giữ) → chống tool-call (giữ).

## Related Code Files

- Modify: `src/systems/aiQaManager.ts` — viết lại `SYSTEM_PROMPT`.
- Modify: `src/config.ts` — `ai.temperature` 0.6 → 0.85.

## Implementation Steps

1. `config.ts`: `temperature: 0.6` → `0.85`.
2. `aiQaManager.ts` — thay `SYSTEM_PROMPT`. Bỏ câu "Ưu tiên tiếng Việt, trả lời gọn và rõ" (giữ "ưu tiên tiếng Việt", bỏ "gọn"). Thêm:
   - **Độ dài**: "Trả lời tự nhiên như đang chat, dài thoải mái khi cần, đừng cụt lủn một câu. Nhưng đừng lan man — vừa đủ đô."
   - **Phân ngữ cảnh**: "Câu hỏi kỹ thuật (config, plugin, skill, lỗi) → trả lời ĐẦY ĐỦ, rõ, chính xác trước; đùa nhẹ sau. Tán gẫu / bị trêu / bị khịa → thả lỏng hết cỡ, cà khịa lại nhiệt tình, mặn mà."
   - **Cà khịa mạnh + phanh**: "Được phép clap-back mạnh, chửi yêu, mỉa mai có duyên khi nhận ra người ta đang đùa/trêu. TUYỆT ĐỐI KHÔNG: xúc phạm ngoại hình/gia đình thật, phân biệt vùng miền/giới tính/tôn giáo, đụng chuyện nhạy cảm thật (giới tính thật, bệnh tật, tài chính), hoặc chọc khi người ta đang buồn/cần giúp thật. Vui là chính, không làm ai tổn thương thật."
3. Giữ nguyên khối "DANH TÍNH" và khối chống tool-call XML.
4. `tsc` exit 0.

## Todo

- [ ] `temperature` → 0.85
- [ ] Viết lại `SYSTEM_PROMPT` (bỏ "gọn", thêm 3 khối mới, giữ 2 khối cũ)
- [ ] `tsc` exit 0
- [ ] Test tay: 1 câu kỹ thuật + 1 câu trêu, xem giọng

## Success Criteria

- [ ] Câu hỏi kỹ thuật vẫn chính xác, dài/đầy đủ hơn trước
- [ ] Câu bị trêu → Stella cà khịa lại rõ rệt, tự nhiên
- [ ] Không lộ tên model khi bị hỏi (khối danh tính còn nguyên)
- [ ] Không xuất XML tool-call

## Risk Assessment

- **Quá lố**: cà khịa mạnh có thể ra câu lố với người mới. Phanh = vùng cấm trong prompt + user quan sát vài hôm đầu, báo chỉnh. Rollback: revert 1 commit (chỉ 2 file, không schema).
- **temperature cao hơn** → thỉnh thoảng lạc đề. 0.85 vẫn an toàn cho chat; nếu lạc nhiều thì hạ 0.75.
