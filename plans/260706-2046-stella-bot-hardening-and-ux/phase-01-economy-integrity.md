---
phase: 1
title: "Economy Integrity"
status: completed
priority: P1
dependencies: []
---

# Phase 1: Economy Integrity

<!-- Updated: Validation Session 1 - confirmed rate reward is one-time immutable (RATED transition pays out once, no re-rate) -->

## Overview

Close the two active Scoin money-printers (C1 rating spam, C2 concurrent sell) plus the giveaway-join overspend TOCTOU (I6). These allow unbounded or duplicated currency creation and are exploitable today with only a mouse.

## Key Insight

`adjustScoinTx` (scoinManager.ts:90) already rejects negative balances, but reads balance via `upsert` inside the tx. Under Postgres READ COMMITTED (Prisma default) two concurrent transactions both read the pre-decrement balance and both pass the check → overspend. Fixing economy dupes requires either an atomic conditional update or serialization, not just a balance check.

## Requirements

- Functional: each rating rewards the target exactly once; each sell pays out exactly once; giveaway entry cost cannot drive balance negative under concurrency.
- Non-functional: no schema migration that breaks existing rows; fixes must hold under concurrent button clicks (double-click, multi-tab).

## Architecture

Atomic-guard pattern via conditional `updateMany` on the `status` field, and conditional balance decrement via `updateMany` with a balance floor in the WHERE clause.

## Related Code Files

- Modify: `src/systems/requestManager.ts` (C1 — `rateRequest`)
- Modify: `src/commands/star.ts` (C2 — `sell` branch)
- Modify: `src/systems/giveawayManager.ts` (I6 — `joinGiveaway` entry-cost deduction)
- Modify: `src/events/interactionCreate.ts` (C1 — disable rate buttons after rating)

## Implementation Steps

1. **C1 — `rateRequest` (requestManager.ts:233-266):** Inside the tx, gate the state transition atomically. Replace the final `requestPost.update({ where: { id }, data: { status: 'RATED' } })` with `updateMany({ where: { id, status: 'DONE' }, data: { status: 'RATED' } })`; capture `count`. If `count === 0`, throw the already-rated error and abort the tx (so the review upsert + score increment + scoin credit all roll back). This makes the reward fire once — only the transition `DONE → RATED` pays out.
   - Also require `request.status === 'DONE'` at the top-level read guard (currently only checks requester + claimedById), so re-rating a RATED request is rejected before the tx.
2. **C1 UI — interactionCreate.ts:297-301 (`rate` branch):** the handler already does `interaction.update({ components: [] })` which strips the buttons on success. Confirm that on the *error* path (already rated) the original rate message's buttons are also disabled so a second click can't even be attempted. Since the rate embed is a standalone message, on caught error call `interaction.update({ components: [] })` when the error is the already-rated case, else ephemeral reply.
3. **C2 — `/star sell` (star.ts:336-349):** the payout `total` is computed from `getState` read *before* the tx. Move the inventory read inside the tx and compute payout from the row values returned by the conditional clears. Concretely: inside `$transaction`, do `const inv = await tx.starInventory.update({ where: { userId }, data: { dust:0,... }, })` — but `update` returns the NEW (zeroed) row. Instead read-then-zero atomically: `const inv = await tx.starInventory.findUnique({ where: { userId } })` inside the tx, compute legacy value, then `updateMany({ where: { userId, dust: inv.dust, small: inv.small, bright: inv.bright, comet: inv.comet, galaxy: inv.galaxy }, data: { dust:0,... } })`; if `count === 0` abort (another sell won the race). Do the same guard for `starItemStack.deleteMany` by summing quantities read inside the tx and deleting by matching ids/quantities, or gate the whole payout on the inventory `updateMany` count. Only call `adjustScoinTx` with the computed total when the conditional clear succeeded.
   - Simpler alternative acceptable if preferred: wrap sell in an app-level per-user lock reusing the existing `huntLocks` Map pattern (a `sellLocks` Map), so concurrent sells serialize. Note this is process-local only; the conditional-update approach is DB-correct and preferred.
4. **I6 — `joinGiveaway` (giveawayManager.ts:184-196):** move the entry-cost balance check inside the tx and make the deduction conditional. `adjustScoinTx` with `allowNegative=false` already throws if balance would go negative, but the read is non-atomic. Replace the plain decrement with a conditional `user.updateMany({ where: { id: userId, scoinBalance: { gte: entryCost } }, data: { scoinBalance: { decrement: entryCost } } })`; if `count === 0` throw "not enough Scoin". Then write the `ScoinTransaction` ledger row inside the same tx. This closes the concurrent double-join overspend.

## Todo List

- [ ] C1 atomic RATED transition + top-level DONE guard
- [ ] C1 rate buttons stripped on both success and already-rated paths
- [ ] C2 sell payout computed+cleared atomically (conditional updateMany)
- [ ] I6 giveaway entry-cost conditional decrement
- [ ] `npm run build` clean

## Success Criteria

- [ ] Spam-clicking a 5-star rate button credits the target exactly once (2nd click → "đã rate" error, no scoin change).
- [ ] Two concurrent `/star sell` invocations pay the inventory value once total, not twice.
- [ ] Concurrent giveaway joins with entryCost cannot push `scoinBalance` below 0.

## Risk Assessment

- **Risk:** conditional `updateMany` on many balance columns for sell is verbose/brittle. **Mitigation:** gate solely on the `starInventory` conditional update count; clear item stacks in the same tx only when that count is 1.
- **Risk:** aborting a tx mid-way must roll back the ledger row + score increment. **Mitigation:** throw *inside* the `$transaction` callback so Prisma rolls back atomically; never write ledger before the guard passes.

## Security Considerations

Currency integrity is the core asset here. All three fixes must be transactional and conditional; a balance *read* followed by an unconditional *write* is the anti-pattern being removed.
