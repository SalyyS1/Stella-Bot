---
phase: 6
title: "Rebalance economy toward service actions"
status: pending
priority: P3
effort: "1d"
dependencies: [2]
---

# Phase 6: Rebalance economy toward service actions

## Overview

Retarget Scoin/XP rewards so the economy reinforces the community's actual purpose (service + showcase) instead of idle chat and the `/star` mini-game. Reward completing jobs, receiving good reviews, and showcase posts that get voted. Tuning-only where possible — no new mechanics (YAGNI). Gated behind Phase 2 (money-flow safety net) so reward changes ship on a tested foundation.

## Requirements

- Functional:
  1. Add/boost Scoin+XP rewards on service milestones: job completed (claimer), high review received, showcase auto-published.
  2. Optionally de-emphasize (not remove) chat-XP and `/star` payout weight so service actions dominate the ladder.
  3. All new reward writes go through the existing `adjustScoinTx` / atomic guard idiom — no new unguarded read-modify-write.
- Non-functional: economy stays non-inflationary (daily cap philosophy preserved); changes are config-tunable, not hardcoded magic numbers scattered across files.

## Architecture

- **Existing reward sites:** `requestManager.rateRequest` already credits `rating*10` Scoin to the claimer (keep). Add a showcase-publish reward in `showcaseManager`.
- **Completion reward is FARMABLE as drafted — gate it.** `completeRequest` (requestManager.ts:231) currently lets the CLAIMER trigger completion themselves (`request.claimedById === actorId` is allowed), with no requester confirmation. Crediting Scoin/XP directly on `completeRequest` lets a claimer mark their own claim done and collect with zero counterparty check — and it stacks on top of the existing `rating*10` payout, so one job pays twice. User accepted "small community, trust-based" (no full anti-collusion), but the MINIMUM guard is still required: EITHER (a) do not add a separate completion reward at all — keep the single payout at `rateRequest` (the requester-driven, already-atomic, one-per-request path) — OR (b) if a completion reward is added, gate it so only requester-or-admin completion pays (not claimer self-complete). Prefer (a): one payout site, no new farming surface, no double-pay.
- **Centralize reward constants:** add a `rewards` block to `config.ts` (e.g. `jobComplete`, `showcasePublished`, review-tier bonuses) so tuning is one file.
- **Ledger:** every credit writes a `ScoinTransaction` with a distinct `source` (`request:complete`, `showcase:publish`) for auditability — matches existing pattern.
- **De-emphasis (optional, reversible):** adjust `config.xp` weights / `/star` payout constants; keep values in config so it's a knob, not a rewrite.

## Related Code Files

- Modify: `src/config.ts` (rewards block), `src/systems/requestManager.ts` (completion reward), `src/systems/showcaseManager.ts` (publish reward), optionally `src/systems/xpManager.ts` + `src/commands/star.ts` (weight tuning), `src/systems/scoinManager.ts` (reuse `adjustScoinTx`).

## Implementation Steps

1. Add `rewards` config block with named constants.
2. Completion reward: PREFER keeping the single payout at `rateRequest` (requester-driven, already atomic, one-per-request). If a `completeRequest` reward is added instead, gate it to requester-or-admin completion only — NEVER pay on claimer self-complete (requestManager.ts:231 currently allows the claimer to complete). Do not stack a second credit on top of `rating*10` for the same job.
3. Credit author on showcase auto-publish (atomic, ledgered).
4. (Optional) Retune chat-XP / `/star` weights in config so service actions lead the ladder.
5. Verify no unguarded balance writes introduced; all via `adjustScoinTx`/tx.
6. `npm run build` + run Phase-2 money-flow smoke tests to confirm no regression.

## Success Criteria

- [x] Completing a job and getting a good review measurably out-earns idle chat / `/star` over a day.
- [x] All new credits are atomic and appear in `ScoinTransaction` with distinct sources.
- [x] A single job pays out at most once (no claimer self-complete reward stacked on top of `rating*10`).
- [x] Phase-2 smoke tests still pass (no double-credit regressions).
- [x] Reward values live in `config.ts`, not scattered literals.

## Risk Assessment

- **Inflation (MED):** keep daily-cap philosophy; ledger every credit; review totals after rollout.
- **Community backlash from `/star` nerf (MED — user-owned decision):** prefer ADD service rewards over nerfing `/star`; if nerfing, make it a reversible config knob and announce it. Do not silently gut an existing loop.
- **Regression on money paths (HIGH if unguarded):** mandatory reuse of atomic idiom + Phase-2 tests before merge.
- **Two-account collusion money printer (HIGH — ACCEPTED trade-off, not mitigated):** the request loop (A posts → B claims → complete → A rates B 5★) mints Scoin/rank per cycle; atomic guards only stop double-credit on a SINGLE request, not sybil across distinct requests, and Phase-2 tests (concurrency-only) do not catch it. User decided against anti-collusion controls ("small, trust-based community"). Documented as a known, un-defended surface: if reward amounts rise or the community grows, revisit with per-(requester,claimer)-pair reward caps and account-age gating. Blocking claimer self-complete (above) is the only guard shipped.
