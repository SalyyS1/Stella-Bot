---
name: phase-03-weekly-rewards
status: pending
created: 2026-07-26T12:17:53Z
updated: 2026-07-26T12:17:53Z
---

# Phase 03 — Weekly Leaderboard Rewards (Bảng vàng tuần)

## Files to CREATE (own ONLY this; do NOT edit any other file)
- `src/systems/weekly-reward-manager.ts`

## Read first (context)
- `prisma/schema.prisma` → `WeeklyActivity` (@@id [userId, weekKey]), `WeeklyRewardRun` (weekKey @id)
- `src/config.ts` → `config.weeklyRewards` (enabled, channelId, announceHour, prizes[3], minXp), `config.maintenance.timezone`
- `src/systems/trivia-scheduler.ts` → house scheduler pattern (setInterval + busy flag)
- `src/systems/scoinManager.ts` → `adjustScoin`
- `src/commands/top.ts` → leaderboard embed formatting style
- `src/utils/adminLog.ts` → `sendAdminLog`

## Requirements
- `weekKeyFor(date: Date): string` — the MONDAY of that date's week as yyyy-MM-dd, computed in `config.maintenance.timezone` via `Intl.DateTimeFormat` parts (year/month/day/weekday) — pure date-part math, no host-TZ reliance, no external deps.
- `recordWeeklyActivity(userId: string, xpGained: number): Promise<void>` — exported, **never throws** (try/catch + console.error); no-op when disabled; `weeklyActivity.upsert` on (userId, currentWeekKey): messages +1, xp +xpGained.
- `startWeeklyRewardScheduler(client): void` — 10-min tick, busy flag, like trivia-scheduler:
  1. Skip unless enabled, weekday (in configured TZ) is Monday, hour === announceHour.
  2. `target = weekKeyFor(now - 7 days)` (last week's Monday).
  3. **Claim before paying** (restart-safe): `weeklyRewardRun.create({ weekKey: target })` — catch P2002 unique violation → already ran → return silently.
  4. Winners: `weeklyActivity.findMany({ where: { weekKey: target, xp: { gte: minXp } }, orderBy: [{ xp: 'desc' }, { messages: 'desc' }, { userId: 'asc' }], take: 3 })`.
  5. Award `prizes[i]` via `adjustScoin(..., 'Thưởng bảng vàng tuần', 'weekly:reward', target)`.
  6. Announce ONE embed in `channelId`: 🥇🥈🥉 mentions + XP + tin nhắn + prize; VN copy. No winners → record run, post nothing.
  7. Errors after claim: log + `sendAdminLog` (accepted trade-off: never double-pay > retry).

## Success criteria
- Restart at any point cannot double-pay (unique weekKey claimed first).
- Tie-break deterministic (xp → messages → userId).
- Never throws out of `recordWeeklyActivity` (it sits in the hot message path).
- No edits outside owned file.
