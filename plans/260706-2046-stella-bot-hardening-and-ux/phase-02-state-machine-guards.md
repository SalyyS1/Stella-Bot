---
phase: 2
title: "State-Machine Guards"
status: completed
priority: P1
dependencies: [1]
---

# Phase 2: State-Machine Guards

## Overview

Eliminate double-execution across giveaway end/reroll/cancel, showcase publish, and request claim. Root cause everywhere: read status → act → write status, with no atomicity. Fix pattern: conditional `updateMany` on `status` and act only when `count === 1`.

## Key Insight

All affected models (`Giveaway`, `ShowcasePost`, `RequestPost`) store `status` as a plain string with no DB-level state-machine constraint. The transition itself must be the concurrency gate: whoever flips the status first owns the side effects (DMs, forum thread, refunds, reward delivery).

## Requirements

- Functional: a giveaway ends once (winners drawn + DMed once); reroll replaces winners (per user decision); cancel and end are mutually exclusive; a showcase publishes one forum thread; a request is claimed by exactly one user.
- Non-functional: guards must hold across scheduler-tick vs manual-action races and overlapping scheduler ticks.

## Related Code Files

- Modify: `src/systems/giveawayManager.ts` (C3 end race, C4 reroll guard, I2 cancel TOCTOU, reroll semantics, scheduler overlap)
- Modify: `src/systems/showcaseManager.ts` (C5 publish race)
- Modify: `src/systems/requestManager.ts` (claim race)

## Implementation Steps

1. **C3 — atomic end (giveawayManager.ts:231-256):** at the start of `endGiveaway`, before drawing, claim the transition: `const claimed = await prisma.giveaway.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'ENDED' } })`. If `claimed.count === 0`, return early (someone else ended/cancelled it). Only proceed to `pickWinners` + DM + delivery rows after winning the claim. For reroll (see step 2) gate on `ENDED` instead.
2. **C4 + reroll semantics — replace winners (giveawayManager.ts:234, 243-256):** reroll currently skips the status check and *appends* winners. Per user decision (replace old winners):
   - Require `status === 'ENDED'` for reroll; reject `ACTIVE` and `CANCELLED`.
   - Load previous `winnerIds`, draw fresh winners from `validEntries` **excluding** previous winners, then **overwrite** `winnerIds` with the new set (not concat). DM only the new winners.
   - Keep the reward-delivery rows consistent: mark superseded winners' deliveries as replaced or leave historical rows but only create new delivery rows for the new winners.
3. **I2 — cancel/end mutual exclusion (giveawayManager.ts:296-314):** inside the cancel tx, gate refunds on a conditional transition: `const cancelled = await tx.giveaway.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'CANCELLED' } })`; refund entries only if `cancelled.count === 1`. If 0, the giveaway already ended — do not refund (winners already drawn).
4. **Scheduler overlap (giveawayManager.ts:323):** `setInterval(async …)` does not await. Add a module-level in-flight flag (`let schedulerBusy = false`) set at tick start and cleared in a `finally`; skip the tick if already busy. Combined with the atomic end-claim in step 1, this prevents re-processing the same due giveaways.
5. **C5 — showcase publish once (showcaseManager.ts:189-268):** before creating the forum thread, claim the transition: `const claimed = await prisma.showcasePost.updateMany({ where: { messageId, status: 'VOTING' }, data: { status: 'PUBLISHING' } })`. If `count === 0`, return (already handled). Create the thread; on success set `status: 'PUBLISHED'` + `forumThreadId`; on thread-creation failure revert to `VOTING` so a retry can succeed. Add `PUBLISHING` as a transient status (no migration needed — string field). Also dedupe the reaction-trigger vs `publishEligibleShowcases` scheduler path via this same claim.
6. **Request claim race (requestManager.ts:146-167):** replace the unconditional `requestPost.update({ status: 'CLAIMED', claimedById })` with `updateMany({ where: { id, status: 'OPEN' }, data: { status: 'CLAIMED', claimedById: user.id } })` inside the tx; if `count === 0` throw the already-claimed error (rolls back the `requestClaim` upsert). This makes last-writer-wins into first-writer-wins.

## Todo List

- [ ] C3 atomic end-claim before draw
- [ ] C4 reroll requires ENDED + replaces winners (exclude previous)
- [ ] I2 cancel refunds only on successful ACTIVE→CANCELLED
- [ ] Scheduler in-flight guard
- [ ] C5 showcase PUBLISHING claim + revert-on-failure
- [ ] Request claim conditional transition
- [ ] `npm run build` clean

## Success Criteria

- [ ] Simultaneous scheduler-end + manual `/giveaway end` draws and DMs winners exactly once.
- [ ] `/giveaway reroll` on a CANCELLED giveaway is rejected; on an ENDED one it replaces winners without re-DMing the old set.
- [ ] Cancel after an end has already drawn winners does not also refund.
- [ ] A showcase crossing threshold produces exactly one forum thread under concurrent triggers.
- [ ] Two users clicking "Nhận job" simultaneously: one succeeds, the other gets "đã có người nhận".

## Risk Assessment

- **Risk:** `PUBLISHING` transient status left stuck if the process dies mid-publish. **Mitigation:** `publishEligibleShowcases` should also re-claim `PUBLISHING` rows older than N minutes back to `VOTING`, or treat `PUBLISHING` as retryable on next sweep.
- **Risk:** reroll "exclude previous winners" may exhaust the entry pool. **Mitigation:** if remaining eligible < winnersCount, draw what's available and report the shortfall (mirror existing short-list handling in `pickWinners`).

## Security Considerations

Double reward delivery (giveaway) and duplicate claims are integrity issues; atomic transitions are the authoritative fix.
