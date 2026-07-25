---
phase: 3
title: "Trivia auto-game with Scoin rewards"
status: pending
priority: P2
effort: "1-2d"
dependencies: [1]
---

# Phase 3: Trivia auto-game với Scoin rewards

## Overview

Stella tự đăng đố vui Minecraft ở kênh chat (`config.channels.chat` = `943893730123980881`), random 3-4 lần/ngày, né giờ ngủ. Ai trả lời đúng đầu tiên → thưởng Scoin, chặn farm (≤5 lần/người/ngày). Ngân hàng câu hỏi hardcode trong JSON — không gọi AI sinh câu (rẻ, không sai đáp án).

## Requirements

- Functional: scheduler tự đăng trivia 3-4 lần/ngày random, né 1h-8h sáng.
- Functional: bắt đáp án đúng đầu tiên trong kênh chat, phát Scoin qua `adjustScoin()`.
- Functional: chặn farm — mỗi người thắng tối đa 5 lần/ngày (đếm qua `ScoinTransaction` source `trivia:win`).
- Functional: chỉ 1 câu trivia "đang mở" tại một thời điểm; hết hạn (vd 5') không ai đúng → đóng, công bố đáp án.
- Non-functional: state câu đang mở giữ RAM (mất khi restart chấp nhận được — casual game); không cần bảng riêng.

## Key Insights

- Mẫu scheduler đã có: `startGiveawayScheduler` (`setInterval` + busy flag). Bắt chước pattern này.
- Phát Scoin: `adjustScoin(userId, amount, reason, source, metadata)` — source `trivia:win` để đếm cap/ngày.
- Đếm cap/ngày: query `ScoinTransaction` where `userId` + `source='trivia:win'` + `createdAt >= đầu ngày`.
- Bắt đáp án: nối vào `messageCreate.ts` — thêm nhánh khi `channelId === config.channels.chat` và có câu trivia đang mở.

## Architecture

- `data/trivia-questions.json`: mảng `{ q, answers: string[], hint? }`. `answers` chứa các biến thể chấp nhận (thường hoá lowercase + trim để so).
- `src/systems/trivia-manager.ts`:
  - State RAM: `activeQuestion: { q, answers, postedAt, messageId } | null`.
  - `postTrivia(client)`: chọn câu random, gửi embed vào kênh chat, set `activeQuestion`.
  - `handleTriviaAnswer(message)`: nếu có `activeQuestion` và message match 1 trong `answers` → người đầu tiên thắng; check cap/ngày; `adjustScoin`; công bố; clear `activeQuestion`. Trả `true` nếu đã xử lý (để messageCreate return sớm khi cần).
  - `expireTrivia(client)`: nếu `activeQuestion` quá hạn (vd 5') → đóng, công bố đáp án, clear.
- `src/systems/trivia-scheduler.ts`:
  - `startTriviaScheduler(client)`: `setInterval` mỗi ~30' → quyết định ngẫu nhiên có đăng không, sao cho kỳ vọng 3-4 lần/ngày, chỉ trong khung 8h-1h (né 1h-8h). Gọi `expireTrivia` mỗi tick.
- Wiring:
  - `ready.ts`: thêm `startTriviaScheduler(client)`.
  - `messageCreate.ts`: trong nhánh xử lý, khi `channelId === config.channels.chat` → gọi `handleTriviaAnswer(message)`. KHÔNG return sớm toàn cục (kênh chat còn chạy XP) — chỉ xử lý trivia rồi cho chảy tiếp XP như thường.

## Related Code Files

- Create: `data/trivia-questions.json` — 50-100 câu Minecraft + đáp án.
- Create: `src/systems/trivia-manager.ts` — state + post + chấm + expire.
- Create: `src/systems/trivia-scheduler.ts` — lịch random né giờ ngủ.
- Modify: `src/events/ready.ts` — gọi `startTriviaScheduler`.
- Modify: `src/events/messageCreate.ts` — nối `handleTriviaAnswer` cho kênh chat.
- Modify (optional): `src/config.ts` — thêm block `trivia` (reward, cap, expire, khung giờ) để dễ chỉnh.

## Implementation Steps

1. `config.ts`: thêm `trivia: { channel: channels.chat, rewardMin: 5, rewardMax: 10, dailyWinCap: 5, expireMs: 5*60_000, activeHours: { start: 8, end: 1 }, targetPerDay: 3.5 }`.
2. `data/trivia-questions.json`: soạn 50-100 câu (kiến thức Minecraft: crafting, mob, block, version…). Mỗi câu nhiều biến thể đáp án (vd "creeper" / "con creeper").
3. `trivia-manager.ts`:
   - Load JSON 1 lần (require).
   - `postTrivia`: random câu, embed "Đố vui Minecraft" + câu hỏi, gửi kênh chat, lưu `activeQuestion`.
   - `handleTriviaAnswer`: chuẩn hoá message (lowercase, trim, bỏ dấu câu) so với `answers`; người đầu tiên đúng → check cap ngày (query ScoinTransaction) → nếu chưa quá cap: `adjustScoin(uid, random(rewardMin,rewardMax), 'Trivia win', 'trivia:win', questionId)`, reply chúc mừng + số Scoin; nếu quá cap: vẫn khen đúng nhưng báo "hết lượt thưởng hôm nay"; clear `activeQuestion`.
   - `expireTrivia`: quá `expireMs` → gửi "Hết giờ! Đáp án: …", clear.
4. `trivia-scheduler.ts`: `setInterval` ~30', mỗi tick: `expireTrivia(client)`; nếu trong `activeHours` và random gate đạt (xác suất tính từ `targetPerDay` / số tick trong khung giờ) và không có `activeQuestion` → `postTrivia(client)`.
5. Wire `ready.ts` + `messageCreate.ts`.
6. `tsc` exit 0.

## Todo

- [ ] `config.trivia` block
- [ ] `data/trivia-questions.json` (50-100 câu)
- [ ] `trivia-manager.ts` (post + chấm đúng-đầu-tiên + cap/ngày + expire)
- [ ] `trivia-scheduler.ts` (random 3-4/ngày, né 1h-8h)
- [ ] Wire `ready.ts`
- [ ] Wire `messageCreate.ts` (kênh chat)
- [ ] `tsc` exit 0

## Success Criteria

- [ ] Trivia tự đăng ~3-4 lần/ngày ở kênh chat, KHÔNG bao giờ trong 1h-8h (kiểm log timestamp)
- [ ] Người đúng đầu tiên nhận Scoin; người thứ 2 không nhận
- [ ] Một người không nhận quá 5 lần thưởng/ngày (kiểm ScoinTransaction source `trivia:win`)
- [ ] Câu không ai đúng trong 5' → tự đóng + công bố đáp án
- [ ] Chỉ 1 câu mở tại một thời điểm

## Risk Assessment

- **Đăng trùng lúc đang có câu mở**: chặn bằng `if (activeQuestion) return` trong postTrivia.
- **Đáp án khó match** (dấu, viết hoa, biến thể): chuẩn hoá 2 vế + nhiều `answers` biến thể. Rủi ro thấp, chấp nhận được cho casual.
- **Farm nhiều tài khoản**: cap theo user; đa tài khoản ngoài phạm vi (đã có ở phần kinh tế chung). Không xử lý thêm ở đây (YAGNI).
- **Mất câu đang mở khi restart**: chấp nhận (RAM-only) — game casual, scheduler đăng câu mới sau đó.
