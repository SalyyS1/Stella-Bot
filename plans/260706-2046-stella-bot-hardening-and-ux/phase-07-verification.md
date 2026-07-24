---
phase: 7
title: "Verification"
status: in-progress
priority: P1
dependencies: [1, 2, 3, 4, 5, 6]
---

# Phase 7: Verification

## Overview

Prove every fix works and nothing regressed. Combines automated build/type checks with targeted concurrency tests for the atomic-guard fixes and a manual walkthrough of each Discord flow. This is the gate before merge.

## Key Insights

- The critical fixes (Phases 1-2) are concurrency defects — a passing `tsc` build does NOT prove them fixed. They need explicit concurrent-execution tests or a reasoned manual race simulation.
- There is no existing test framework in `package.json` (no jest/vitest/mocha). Introducing one is in scope only for the concurrency-sensitive economy/state paths; do not scaffold a full suite for untouched code (YAGNI).
- Postgres is the real datastore; concurrency tests must hit a real DB (a disposable test schema), not mocks — mocked tx isolation would hide the exact READ COMMITTED race we're fixing.

## Requirements

- Functional: all CRITICAL and IMPORTANT findings from the red-hat report verified fixed.
- Non-functional: `npm run build` (clean + prisma generate + tsc) exits 0; no new type errors.

## Architecture

- Add a minimal test runner (vitest — lightest TS-native option) scoped to concurrency-sensitive managers only.
- Concurrency tests use `Promise.all` to fire N simultaneous operations against a test Postgres schema and assert the invariant (exactly one winner draw, no double-spend, exactly one publish, single rating reward).

## Related Code Files

- Create: `src/systems/__tests__/economy-integrity.test.ts` (rate reward idempotency, sell double-fire, giveaway entryCost overspend)
- Create: `src/systems/__tests__/state-machine-guards.test.ts` (double-end, reroll-on-cancelled, double-publish)
- Modify: `package.json` (add vitest + `test` script) — only if user accepts a test dep
- Create: `.env.test` reference in docs (test DATABASE_URL) — not committed

## Implementation Steps

1. **Build gate:** run `npm run build`; fix any type errors introduced by Phases 1-6.
2. **Test runner:** add vitest as devDependency; add `"test": "vitest run"` script.
3. **Economy tests:** 
   - Fire 10 concurrent `rateRequest` for same request → assert target credited exactly once, status RATED.
   - Fire 2 concurrent `/star sell` for same inventory → assert payout credited once.
   - Fire 2 concurrent giveaway joins at balance = entryCost → assert only one succeeds, balance never negative.
4. **State-machine tests:**
   - Fire concurrent `endGiveaway` (scheduler + manual) → assert one draw, one DM batch, one ENDED write.
   - `reroll` on CANCELLED giveaway → assert rejected, no DMs.
   - `reroll` on ENDED → assert winners replaced (not appended), count == winnersCount.
   - Concurrent `maybePublishShowcase` → assert exactly one forum thread.
5. **Manual Discord walkthrough** (staging bot): request lifecycle, giveaway create→join→end→reroll, star hunt/sell, music join/control, language switch, each error path shows friendly copy.
6. **Security checks:** confirm Lavalink refuses to boot without `LAVALINK_SERVER_PASSWORD`; confirm `http` source disabled (or IP-filtered); confirm non-same-voice user cannot control music.
7. **Regression sweep:** run full build once more; confirm no untouched behavior broke.

## Todo List

- [ ] `npm run build` exits 0
- [ ] Economy concurrency tests pass
- [ ] State-machine concurrency tests pass
- [ ] Manual Discord walkthrough complete
- [ ] Security verifications pass
- [ ] No regressions

## Success Criteria

- [ ] Every CRITICAL (C1-C6) and IMPORTANT finding has a passing test or documented manual verification.
- [ ] Concurrency tests demonstrably fail against pre-fix code and pass against post-fix code (proves the fix, not just the code path).
- [ ] Build clean; no fake data / mocks used to force green.

## Risk Assessment

- **Risk:** adding a test framework expands scope. **Mitigation:** scope tests strictly to the concurrency-sensitive paths being fixed; user approval gate on the vitest dep.
- **Risk:** concurrency tests are flaky. **Mitigation:** assert invariants (count == 1) not timing; use real DB transactions; run each N times.
- **Risk:** no staging bot available for manual walkthrough. **Mitigation:** flag as unresolved; fall back to documented reasoning per flow.

## Next Steps

On green, hand off for merge. Update `docs/project-changelog.md` and `docs/development-roadmap.md` per documentation-management rules.
