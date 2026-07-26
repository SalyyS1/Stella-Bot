---
name: community-quests-shop-weekly-birthday
status: complete
created: 2026-07-26T12:17:53Z
updated: 2026-07-26T12:35:00Z
---

# Community Features: Daily Quests, Scoin Shop, Weekly Rewards, Birthdays

4 features for STELL bot (VN Minecraft creator community). All reuse existing scoin/XP/scheduler infra. Foundations (schema, migration `20260726191753_community_quests_shop_weekly_birthday`, config sections) already applied.

## Phases

| # | Phase | New files | Status |
|---|-------|-----------|--------|
| 1 | [Daily quests](phase-01-daily-quests.md) | `src/systems/quest-manager.ts`, `src/commands/quest.ts` | done |
| 2 | [Scoin shop](phase-02-scoin-shop.md) | `src/systems/shop-manager.ts`, `src/commands/shop.ts` | done |
| 3 | [Weekly rewards](phase-03-weekly-rewards.md) | `src/systems/weekly-reward-manager.ts` | done |
| 4 | [Birthdays](phase-04-birthday.md) | `src/systems/birthday-manager.ts`, `src/commands/birthday.ts` | done |
| 5 | Integration wiring (controller) | edits: `ready.ts`, `xpManager.ts`, `daily.ts`, `trivia-manager.ts`, `voteManager.ts`, `star.ts` | done |

## Review outcome (2026-07-26)
- code-reviewer: spec compliance ALL PASS; 0 critical; 1 important FIXED (quest bonus display now uses the actual paid/projected amount from quest-manager); 1 minor FIXED (yesterdayQuestDay anchored at UTC noon); 1 minor accepted (ShopPurchase audit row after debit — ScoinTransaction ledger is authoritative).
- Verified: `tsc --noEmit` clean, self-check 31/31.
- NOTE deploy: run `npm run db:migrate` (migration `20260726191753_community_quests_shop_weekly_birthday`) before starting the new build.

## Dependencies
- Phases 1-4 independent, parallel-safe (file ownership disjoint; NO shared-file edits by agents).
- Phase 5 (controller only): scheduler starts in `ready.ts`; quest/weekly hooks into XP award path, daily claim, trivia settle, vote add, star hunt.

## Acceptance
- `npx tsc --noEmit` clean; `npm test` (self-check) passes.
- All scoin mutations via `scoinManager` helpers (atomic, ledgered). No manual balance math.
- Commands defer-first; Vietnamese copy; `config.ui.emojis`; try/catch with user-facing errors.
- Restart-safe: no double weekly payout (unique weekKey claim), no double birthday gift (lastCelebratedYear claim), quest assignment idempotent (unique + deterministic pick).

## Key decisions
- Quest assignment lazy (first activity of day) — no scheduler; deterministic pick per (user, day) so concurrent creates collide harmlessly on unique constraint.
- Shop = color roles auto-created by bot (`markInternalAntiRaidAction('roleCreate','*')` before create; single create call, NO setPosition after — position-only changes would trip anti-raid via roleUpdate).
- weekKey = Monday date (yyyy-MM-dd, Asia/Saigon) — avoids ISO week math.
- Birthday Feb-29 → celebrated Mar 1 in non-leap years.
