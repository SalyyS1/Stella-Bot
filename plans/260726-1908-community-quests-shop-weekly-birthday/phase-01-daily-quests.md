---
name: phase-01-daily-quests
status: pending
created: 2026-07-26T12:17:53Z
updated: 2026-07-26T12:17:53Z
---

# Phase 01 — Daily Quests (Nhiệm vụ ngày)

## Files to CREATE (own ONLY these; do NOT edit any other file)
- `src/systems/quest-manager.ts`
- `src/commands/quest.ts`

## Read first (context)
- `prisma/schema.prisma` → models `DailyQuest`, `User` (fields `questStreak`, `lastQuestDay`)
- `src/config.ts` → `config.quests` (enabled, perDay, allDoneBonusBase/PerStreak/Cap), `config.maintenance.timezone`, `config.ui.emojis`
- `src/systems/scoinManager.ts` → `adjustScoin`, `adjustScoinTx` (ALL scoin mutations go through these)
- `src/commands/daily.ts` → house patterns: timezone day-key via `Intl.DateTimeFormat`, defer-first, embed style, streak calc

## Requirements

### quest-manager.ts
Catalog (const, in this file): key → { target, reward, label (VN), emoji }
- `chat`:  target 15, reward 15 — "Trò chuyện: gửi 15 tin nhắn"
- `daily`: target 1,  reward 10 — "Điểm danh /daily"
- `trivia`: target 1, reward 25 — "Trả lời đúng câu đố của Stella"
- `vote`:  target 2,  reward 15 — "Vote 2 bài showcase/request"
- `star`:  target 1,  reward 15 — "Đi săn sao 1 lần"

API (exported):
- `todayQuestDay(): string` — yyyy-MM-dd in `config.maintenance.timezone` (Intl, en-CA locale trick like daily.ts).
- `recordQuestProgress(userId: string, kind: string, n = 1): Promise<void>` — **never throws** (internal try/catch + console.error); no-op when `!config.quests.enabled` or kind not in catalog. Flow:
  1. Lazy-assign: deterministic pick of `perDay` quest keys for (userId, day) via a simple string hash of `userId + day` (same inputs → same picks, so concurrent callers create identical rows); `createMany({ skipDuplicates: true })`.
  2. `updateMany { userId, day, questKey: kind, completed: false } → progress { increment: n }`.
  3. Completion claim (race-safe): `updateMany { userId, day, questKey: kind, completed: false, progress: { gte: target } } → completed: true`; if `count === 1` → `adjustScoin(userId, reward, 'Hoàn thành nhiệm vụ: <label>', 'quest:complete', `${day}:${kind}`)`.
  4. All-done bonus: if today's completed count === assigned count → inside ONE `prisma.$transaction`: row-lock user (`update { scoinBalance: { increment: 0 } }` pattern from daily.ts), re-read `lastQuestDay`; if already === day → return (bonus already paid). Else streak = (lastQuestDay === yesterday) ? questStreak + 1 : 1; bonus = `min(allDoneBonusBase + allDoneBonusPerStreak * streak, allDoneBonusCap)`; update `questStreak`/`lastQuestDay`; `adjustScoinTx(tx, ..., bonus, 'Hoàn thành đủ nhiệm vụ ngày', 'quest:allDone', day)`.
- `getQuestBoard(userId)` — ensure assigned, return today's quests + user streak (for the command).

### commands/quest.ts
- `/quest` — deferReply ephemeral FIRST; embed: today's quests with `✅`/`⬜`, `progress/target`, reward mỗi quest, dòng streak (`🔥 Chuỗi ngày hoàn thành: N`), tổng bonus khi xong cả 3. VN copy, house emojis/colors.

## Success criteria
- Compiles (`npx tsc --noEmit` — ignore errors from files you don't own).
- Double-completion impossible (claim via updateMany count). Bonus paid at most once per day (lastQuestDay check inside tx).
- No edits outside owned files.
