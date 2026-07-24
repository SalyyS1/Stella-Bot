---
title: "Stella Bot: Fix critical bugs, harden concurrency/security, improve UI/UX"
description: "Fix 6 CRITICAL + 13 IMPORTANT findings from red-hat review; add atomic state-machine guards, economy-dupe fixes, interaction hardening, Lavalink security, and UI/UX polish."
status: in-progress
updated: "2026-07-19T13:44:33Z"
priority: P1
branch: "main"
tags: [bugfix, security, concurrency, ux]
blockedBy: []
blocks: []
created: "2026-07-06T13:58:45.035Z"
createdBy: "ck:plan"
source: skill
---

# Stella Bot: Fix critical bugs, harden concurrency/security, improve UI/UX

## Overview

Remediation plan for the red-hat team review of commits `1197c2d..4c55e7d`. Root cause across 5 of 6 CRITICALs is the same: **read-modify-write on a string `status` field with no atomic guard**. The canonical fix is `updateMany({ where: { id, status: EXPECTED }, data: {...} })` and proceed only if `count === 1`. Phases are ordered by severity and dependency: economy dupes first (active money printers), then state-machine guards, then interaction reliability, security, misc reliability, UX polish, and a final verification gate.

Source report: `plans/reports/red-hat-team-review-260706-2015-giveaway-star-request-music-report.md`

### User decisions locked (from planning interview)
- **Reroll (I4):** replace old winners, not append. Draw fresh `winnersCount`, exclude prior winners from pool, overwrite `winnerIds`.
- **Draw eligibility (I1):** keep re-checking all requirements at draw time — explicit user decision, NOT treated as a bug. Out of scope.
- **Deployment topology:** unknown/unsure. All cache fixes must be correct for both single- and multi-process (short TTL + eventual consistency; no hard pub/sub dependency).
- **UI/UX scope:** all four areas — error feedback, request board & rating, giveaway embed & panel, star/music panels.

## Phases

| Phase | Name | Status | Priority |
|-------|------|--------|----------|
| 1 | [Economy Integrity](./phase-01-economy-integrity.md) | Completed | P1 |
| 2 | [State-Machine Guards](./phase-02-state-machine-guards.md) | Completed | P1 |
| 3 | [Interaction Hardening](./phase-03-interaction-hardening.md) | Completed | P1 |
| 4 | [Security](./phase-04-security.md) | Completed | P1 |
| 5 | [Reliability](./phase-05-reliability.md) | Completed | P2 |
| 6 | [UI-UX](./phase-06-ui-ux.md) | In Progress | P2 |
| 7 | [Verification](./phase-07-verification.md) | In Progress | P1 |

## Dependencies

- Phase 1 and Phase 2 share the `updateMany` atomic-guard idiom AND both modify `giveawayManager.ts` (P1 `joinGiveaway` / P2 end-reroll-cancel) and `requestManager.ts` (P1 `rateRequest` / P2 claim), so they must run sequentially — Phase 1 first (active exploits), then Phase 2. Not parallelizable.
- Phase 3 (interaction hardening) depends on request-flow status semantics from Phase 2 (rate button disabling after RATED).
- Phase 7 verifies all prior phases; must run last.
- Phases 4, 5, 6 are independent and can be done in any order after 1–3.

## Acceptance criteria (plan-level)
- [x] All 6 CRITICAL findings closed with atomic guards or config changes.
- [x] `npm run build` passes (tsc clean).
- [ ] No economy operation can double-credit/double-refund under concurrent clicks (source guards verified; real-Postgres concurrency test still pending).
- [x] Lavalink fails closed on missing password; no repo-public default remains.
- [ ] Request buttons no longer produce token-expiry unhandled rejections (source hardening verified; staging interaction smoke test still pending).

## Validation Log

### Verification Results (Session 1)
- Tier: Full (7 phases)
- Claims checked: 24 | Verified: 24 | Failed: 0 | Unverified: 0
- Method: direct source read of scoinManager.ts, schema.prisma, config.ts, interactionCreate.ts, requestManager.ts, showcaseManager.ts, star.ts, giveawayManager.ts, i18n/index.ts, musicManager.ts, lavalink-host/application.yml.
- Notable confirmation: `adjustScoinTx` (scoinManager.ts:90) guards negatives, but the balance read happens inside the tx via upsert under Postgres READ COMMITTED — concurrent joins both read pre-decrement balance, so the overspend is real. Phase 1 fix (atomic conditional update) stands.

### Interview Answers (Session 1)
All four answers selected the Recommended option; each was already the plan's working assumption, so no design changes — confirmations only.
1. **C6 Lavalink password** → Fail-closed. Accept that deploys relying on the `change_me_lavalink_password` default break until `LAVALINK_SERVER_PASSWORD` is set. Phase 4 must document this as a breaking deploy step.
2. **SSRF / `http` source** → Disable (`http: false`). Direct-link playback is not required; removes cloud-metadata/internal-URL fetch vector. Phase 4.
3. **Music control authz** → Same-voice-channel-as-bot required for stop/skip/shuffle/etc. Phase 4 adds the check in `controlMusic` (or callers) using `member.voice.channelId === player.voiceChannelId`.
4. **C1 rate reward semantics** → One-time, immutable. After status guard, a request rates exactly once; Scoin reward credited once and never re-applied on repeat clicks. Phase 1.

### Whole-Plan Consistency Sweep (Session 1)
Re-read plan.md + all 7 phase files. One contradiction found and fixed:
- **plan.md Dependencies** claimed Phase 1 and Phase 2 "touch different files, so can proceed in parallel." False — both modify `giveawayManager.ts` (P1 `joinGiveaway` vs P2 end/reroll/cancel) and `requestManager.ts` (P1 `rateRequest` vs P2 claim). Corrected to sequential; matches `phase-02` frontmatter `dependencies: [1]` and the task chain (#6→#7→…→#12).

No other stale terms, renamed symbols, or superseded decisions. Reroll=replace and draw-eligibility=re-check-all are stated consistently across plan.md, phase-02, and phase-06. Zero unresolved contradictions.

### Implementation verification (2026-07-19)
- Phases 1–5 verified in source; `npm run build`, `npm audit --omit=dev`, `git diff --check`, and 13 focused assertions pass.
- Phase 6 remains in progress: centralized user-facing error mapping/localization was intentionally not added; existing flow-specific friendly errors retained.
- Phase 7 remains in progress: real-Postgres concurrency tests and a live Discord staging walkthrough are still required before merge/deploy confidence.
- Independent reviewer subagent was interrupted twice; controller adversarial review found and fixed anti-raid fallthrough, showcase mention amplification, and vote snapshot-before-lock races.

<!-- Updated: Validation Session 1 - all recommended options confirmed, no scope change; P1/P2 parallelism claim corrected to sequential -->
