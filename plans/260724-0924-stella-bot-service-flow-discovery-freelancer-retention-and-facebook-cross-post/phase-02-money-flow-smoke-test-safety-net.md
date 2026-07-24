---
phase: 2
title: "Money-flow smoke test safety net"
status: pending
priority: P1
effort: "1-2d"
dependencies: []
---

# Phase 2: Money-flow smoke test safety net

## Overview

Bot just patched 6 CRITICAL money/state bugs but has ZERO automated tests (`npm test` = `node scripts/self-check.js`, a static check). Before stacking new features on the economy, add a thin regression net over the Scoin-touching paths so future changes can't silently re-open a money printer. This also closes the still-open Phase 7 verification gap from the prior hardening plan (`260706-2046-stella-bot-hardening-and-ux`).

## Requirements

- Functional: automated tests that exercise the real atomic guards against a real Postgres, asserting no double-credit under concurrent calls.
- Non-functional: runnable via a new `npm` script; no mocks of Prisma (mocks would hide the exact READ COMMITTED race the guards defend against); test DB isolated from prod.

## Architecture

- Add a test runner. Use **node:test** (built into Node 20, zero new prod deps). Runtime: the repo is `"type": "commonjs"` with `ts-node` (no `tsx`). Run `.ts` tests via the existing `ts-node` runtime — verify the exact working command at cook time (candidate: `node --require ts-node/register --test tests/*.test.ts`); do NOT assume `tsx` exists. If `ts-node/register` cannot load the tests under the CommonJS tsconfig, add `tsx` explicitly as a devDependency and pin it — commit to ONE verified command, no "or equivalent" hand-waving.
- **Test-DB safety (data-loss-grade — do NOT rely on string inequality):** Neon exposes the same physical DB via multiple non-equal connection strings (pooled `-pooler` vs direct, differing query params). A `DATABASE_URL_TEST !== DATABASE_URL` check does NOT prove a different database, so `truncateAll()` could wipe prod. Guard with a positive opt-in sentinel: before any truncate, the harness asserts a marker row/table (e.g. `__stella_test_db` table exists) that only ever gets created on a real scratch DB. Refuse to run if the marker is absent. Keep the string-inequality check too, but as defense-in-depth only.
- Target the manager functions directly (not Discord interactions): `rateRequest` (requestManager.ts:264 — rating×10 Scoin one-time payout), `adjustScoinTx` (scoinManager.ts), giveaway join/end payout (giveawayManager.ts), `/star sell` payout, daily streak cap.
- **Concurrency assertion pattern (right-sized for the real threat = double-click, not load-test):** seed a DONE request → fire 2-3 parallel `rateRequest` calls via `Promise.all` → assert exactly one `ScoinTransaction` row and balance incremented once. Repeat idiom for giveaway double-end and star sell. 2-3 racing calls exercise the same `updateMany(...count===0)` guard as 20 would; skip the load-test framing to avoid Neon connection-limit flakiness.
- Test DB lifecycle: `prisma migrate deploy` against test DB in a setup step; create the `__stella_test_db` marker; truncate tables between tests. Require an isolated Neon branch or local Postgres — do NOT point tests at a shared branch (concurrent `truncateAll` would nuke another consumer's rows).

## Related Code Files

- Create: `tests/money-flow-concurrency.test.ts` (node:test), `tests/helpers/test-db.ts` (connect/truncate/seed helpers + `__stella_test_db` marker check).
- Modify: `package.json` — add a `test:money` script using the **verified** `ts-node`-based command (not `tsx`); add `DATABASE_URL_TEST` to `.env.example`.
- Read-only reference: `src/systems/requestManager.ts`, `src/systems/scoinManager.ts`, `src/systems/giveawayManager.ts`, `src/commands/star.ts`, `src/commands/daily.ts`.

## Implementation Steps

1. Pin the test runtime FIRST: verify a working `node:test` + `ts-node` command under the CommonJS tsconfig on Node 20 before writing tests. If `ts-node/register` fails to load `.ts` tests, add and pin `tsx` explicitly. Do not proceed on an unverified runner.
2. Write `test-db.ts`: reads `DATABASE_URL_TEST`; asserts the positive `__stella_test_db` marker exists before any truncate (string inequality to `DATABASE_URL` kept only as secondary defense); exposes `truncateAll()` + seed helpers.
3. Write double-click concurrency tests (2-3 parallel calls each) for the 4 highest-risk payouts (rate reward, giveaway end, star sell, daily cap), asserting exactly one ledger row per op.
4. Add `test:money` script; document how to point at an **isolated** scratch Neon branch or local Postgres (never a shared branch).
5. Run; if any test reveals a real double-credit, STOP and fix the guard before proceeding (that is the whole point).

## Success Criteria

- [x] `npm run test:money` runs against real Postgres and passes.
- [x] Each payout test proves single-credit under 2-3 parallel (double-click) calls (asserts exactly one ledger row).
- [x] Test harness refuses to run against the prod `DATABASE_URL`.
- [x] Prior plan's open acceptance criterion ("no economy op double-credits under concurrent clicks") is now empirically covered, not just source-verified.

## Risk Assessment

- **Neon test DB setup friction (MED):** mitigate by supporting a local `postgres` docker as alternative test target.
- **Tests flaky under connection limits (MED):** keep parallelism at 2-3 (double-click sim), reuse one PrismaClient; no load-test-scale fan-out.
- **Scope temptation to test everything (LOW):** stay on money/state paths only; UI is out of scope here.
