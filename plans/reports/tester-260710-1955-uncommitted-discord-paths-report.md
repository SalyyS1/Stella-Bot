# QA Report — Uncommitted Discord Paths

---
date: 2026-07-10
scope: uncommitted changes, diff-aware
mode: read-only source verification; report artifact only
---

## Summary

Diff-aware review of 17 tracked changed files. TypeScript passes. Changed command signatures/callers and ignored generated `dist` artifacts are statically aligned. No automated test infrastructure exists. Database-backed behavior and live Discord interaction acknowledgment remain unexecuted because no disposable PostgreSQL URL was provided and production/database access was prohibited.

## Diff Scope

- Changed: `.env.example`, `docs/lavalink-bot-hosting.md`, `lavalink-host/application.yml`, `lavalink-host/start.sh`, 13 files under `src/`.
- Source focus: `music.ts`, `star.ts`, `interactionCreate.ts`, `messageCreate.ts`, giveaway/request/music/showcase/vote managers, i18n, managed channels.
- Renames: none (`git diff --name-status HEAD`).
- Mapped tests: none. No `test` script, runner dependency/config, or `*.test.*` / `*.spec.*` files found outside `node_modules`.
- Auto-escalation: infrastructure/config changed, but complete suite impossible because suite absent.

## Commands / Results

| Command/check | Result |
|---|---|
| `git status --short` | 17 tracked modified paths; `plans/` untracked before this report |
| `git diff --name-status HEAD` / `--stat` | 17 files; 790 insertions, 420 deletions; no rename |
| inspect `package.json`, `tsconfig.json`, test files | No test/coverage/lint scripts. Build = clean dist + Prisma generate + `tsc` |
| `npx tsc --noEmit` | PASS, exit 0, 20.882s |
| `npm run build` | NOT RUN: invokes `prisma generate`, which auto-loads `.env`; forbidden by task |
| signature/caller search | PASS: `playPlaylist` caller consumes `{queued, skipped}`; `maybePublishShowcase` boolean consumed by scheduler/backfill; vote caller safely ignores return; request/giveaway callers match declarations |
| star registration/runtime inspection | PASS: `/star hunt` registers optional `area` + `tool`; upgrade required `tool`; shop optional `buy`; choices and runtime lookups align |
| source/dist inspection | PASS static: 13 changed TS files have corresponding ignored JS artifacts newer than source; key changed symbols/branches present in dist |

## Test Results Overview

- Automated tests run: 0/0
- Passed: 0; failed: 0; skipped: 0
- Static compiler checks: 1 passed, 0 failed
- Flakiness/isolation/cleanup: not measurable; no suite

## Coverage Metrics

- Lines/branches/functions: unavailable. No coverage runner or instrumented tests.
- Effective dynamic coverage of changed DB/Discord paths: 0% in this run.

## Static Regression Findings

- Star: command option count/names valid by inspection; area/tool ownership and Black Hole Gate Rocket Drill Lv.6 checks agree with registration. Transactional buy/upgrade/sell/hunt branches compile. Insufficient funds, duplicate ownership, max level, concurrent sell/hunt paths remain DB-unverified.
- Music: `playPlaylist` return changed from number to `{ queued, skipped }`; sole command caller updated. Generated JS contains new counters and return object.
- Giveaway: button custom IDs parse as `giveaway_{join|leave|participants}_{id}`. Quick and draft modal IDs route correctly. Admin gate, expired draft, entry eligibility/cost, concurrent join, end/reroll/finalization and rollback require DB + Discord mocks/live guild.
- Request: modal IDs/field IDs align. Claim/close/complete use guarded state transitions. Rating uses atomic `DONE -> RATED` gate and strips stale rating components on repeat. Message-create rollback exists if board posting fails. Authorization, concurrent clicks, reward one-time guarantee, and refresh failures remain DB/Discord-unverified.
- Dist: ignored by Git, so commit-level provenance unavailable. Timestamps and semantic spot checks indicate current source was compiled at 19:56. `index.js` executes `dist/index.js`; deployment therefore depends on packaging these ignored artifacts separately.

## Build Status

- Safe typecheck: PASS.
- Declared production build: NOT VERIFIED under no-`.env` constraint.
- Warnings: Git reports LF-to-CRLF conversion warnings for changed tracked text files.
- Dependency resolution: TypeScript and installed imports resolve; Prisma generation not rerun.

## What Is / Is Not Testable Without Disposable PostgreSQL

Testable now: diff mapping, TypeScript type safety, registration/runtime option parity, caller signatures, custom-ID routing, source/dist semantic presence and timestamps.

Not testable now: Prisma schema/client runtime compatibility after regeneration; transactions/atomic gates; insufficient-balance and concurrent-click behavior; giveaway entry/refund/winner lifecycle; request claim/rate rewards; managed-channel fallback with real failures; Discord API message/modal acknowledgment and permission behavior.

## Manual Discord QA Checklist

- Register commands in a test guild; confirm `/star hunt area tool`, `/star upgrade tool`, `/star shop buy` options and choices appear.
- Star: hunt with default/highest tool, explicit owned/unowned tool, each area, Black Hole Gate wrong tool/low level/correct Rocket Drill Lv.6, cooldown double-click.
- Star: buy with insufficient/exact balance; duplicate tool; rebuy buff extends expiry; upgrade missing/max tool; concurrent upgrade; sell empty/non-empty/concurrent; verify Scoin ledger once.
- Giveaway: create via panel and `/giveaway create`; expired draft; non-admin submit; join twice, leave twice, missing required role/level/Scoin, paid entry concurrent click; participant count >50; end and reroll concurrently; verify refund/reward/message state.
- Request: submit PAID/FREE modal; force board-send failure and confirm no dangling DB row; self-claim rejection; two-user simultaneous claim; unauthorized/valid complete and close; rate 1–5; double-rate and simultaneous rate; verify one reward/ledger row and stale buttons removed.
- Music: play playlist containing valid and invalid tracks; verify queued/skipped message, zero-playable error, voice membership/permission errors, button acknowledgment.
- Restart from packaged `dist`; repeat one star, giveaway, request, and playlist path to verify deployed artifact parity.

## Critical Issues / Recommendations

1. High: no automated tests or coverage for transactional money/reward/state paths. Add disposable PostgreSQL integration tests for concurrency and rollback first.
2. High: production build not reproducible under privacy constraint because build couples compile to Prisma `.env` loading. Add a CI-safe test URL/config and isolated build verification.
3. Medium: `dist` ignored yet runtime loads it. Add packaging CI assertion that compiles and verifies artifact freshness.
4. Medium: add Discord interaction unit tests with mocked buttons/modals/messages for custom-ID parsing, authorization, defer/edit/follow-up behavior.

## Unresolved Questions

- Can QA receive a disposable PostgreSQL URL and isolated Discord test guild/bot token?
- Is `dist` expected to ship via `host:prepare`/external package rather than Git?
- Is LF-to-CRLF conversion expected on Windows checkout?
