---
title: "Stella community fun: trivia auto-game, natural clap-back voice, member memory"
description: "Lấp khoảng lặng + Stella nói tự nhiên, cà khịa, nhớ thành viên (có phanh riêng tư)"
status: pending
priority: P1
effort: "3-5d"
tags: [ai, community, engagement]
created: 2026-07-25
---

# Stella community fun: trivia auto-game, natural clap-back voice, member memory

## Overview

3 mảng làm cộng đồng vui hơn, xếp theo rủi ro tăng dần:
1. **Voice revamp** — Stella trả lời tự nhiên, dài vừa, cà khịa mạnh (có vùng cấm). Sửa `SYSTEM_PROMPT` + `temperature`. Rủi ro thấp, làm trước.
2. **Trivia auto-game** — tự đăng đố vui Minecraft ở kênh chat, random 3-4 lần/ngày (né giờ ngủ), thưởng Scoin cho người đúng đầu tiên, chặn farm.
3. **Member memory** — Stella nhớ "fact" ngắn về thành viên (chỉ chat công khai), nạp vào ngữ cảnh để cà khịa cá nhân hoá. Có vùng cấm + lệnh `/stella quên tôi` & `/stella biết gì`. Rủi ro cao nhất, làm cuối, bật/tắt được.

Foundation (Phase 1) gom các thay đổi file dùng chung (`config.ts`, `schema.prisma`) vào một chỗ để 03/04 không cùng sửa schema/config gây rối.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Stella trả lời tự nhiên + cà khịa đúng ngữ cảnh, hết cụt ngủn | P1 |
| 2 | Trivia tự chạy lấp khoảng lặng, thưởng Scoin công bằng (chặn farm) | P1 |
| 3 | Nhớ thành viên có kiểm soát riêng tư, cà khịa cá nhân hoá | P2 |

## Phases

| # | Phase | Status | Depends |
|---|-------|--------|---------|
| 1 | [Foundation: config + Prisma model](./phase-01-start.md) | Pending | — |
| 2 | [Voice revamp: natural clap-back persona](./phase-02-voice-revamp-natural-clap-back-persona.md) | Pending | — |
| 3 | [Trivia auto-game with Scoin rewards](./phase-03-trivia-auto-game-with-scoin-rewards.md) | Pending | 1 |
| 4 | [Member memory with privacy guards](./phase-04-member-memory-with-privacy-guards.md) | Pending | 1 |

## Key Decisions (từ advisory interview)

- Trivia: **random 3-4 lần/ngày**, kênh `943893730123980881` (= `config.channels.chat`), né **1h-8h sáng**.
- Thưởng: **8 Scoin/câu đúng đầu tiên** (< showcase 30), **tối đa 5 lần thắng/người/ngày**.
- Voice: cà khịa **mạnh** nhưng có vùng cấm; **phân ngữ cảnh** (kỹ thuật=chính xác trước, tán gẫu=lầy).
- Memory: **chỉ chat công khai**, **chỉ chọc người đang nói** (không réo người vắng mặt), vùng cấm cứng (drama/tình cảm/thông tin nhạy cảm), có lệnh quên + xem.

## Success Criteria

- [ ] Q&A kỹ thuật vẫn đúng, dài hơn trước; câu tán gẫu có cà khịa rõ (đọc thử ~10 câu)
- [ ] Trivia tự đăng 3-4 lần/ngày đúng kênh, **không bao giờ** trong 1h-8h (log timestamp)
- [ ] Người đúng đầu tiên nhận 8 Scoin, người thứ 2 không; ≤5 lần thắng/người/ngày (bảng `ScoinTransaction`)
- [ ] `/stella quên tôi` xoá sạch fact người gọi (query DB = 0 dòng)
- [ ] Stella không nhắc tên người vắng mặt trong câu chọc (quan sát vài ngày)
- [ ] `tsc` exit 0; smoke test money-flow không hồi quy

## Open Questions

- Số Scoin/câu (8) và cap (5/ngày) là đề xuất — user có thể chỉnh khi test.
- Memory bật mặc định hay chờ quan sát Phase 2-3 ổn rồi mới bật? (đề xuất: env flag `STELLA_MEMORY_ENABLED`, mặc định off).

<!-- slug: stella-community-fun-trivia-auto-game-natural-clap-back-voice-member-memory -->
