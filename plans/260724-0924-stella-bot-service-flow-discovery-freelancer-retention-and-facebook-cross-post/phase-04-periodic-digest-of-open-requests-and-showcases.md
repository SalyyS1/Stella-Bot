---
phase: 4
title: "Periodic digest of open requests and showcases"
status: pending
priority: P2
effort: "1d"
dependencies: [3]
---

# Phase 4: Periodic digest of open requests and showcases

## Overview

Keep the service flow alive with a scheduled digest: bot posts a daily/weekly summary of still-open requests + newest showcases into a highlight channel. Counters the "post dies in a quiet channel" problem by resurfacing unmatched supply/demand.

## Requirements

- Functional:
  1. Scheduled job (daily or weekly, configurable) posts one embed listing OPEN/CLAIMED-but-stale requests + recent showcase posts.
  2. Skips posting when there is nothing new/open (no empty spam).
  3. Links each item back to its original message/thread.
- Non-functional: idempotent via a DB unique constraint (NOT a race-prone last-run timestamp); correct on single- AND multi-process (topology unknown). Uses Asia/Saigon tz formatting like existing `maintenance` code.

## Architecture

- **No reusable scheduler exists — do not claim reuse.** `maintenanceManager.ts` is NOT a general tz scheduler: `startMaintenanceScheduler` fires a fixed hourly `setInterval` (`:244-248`) and `runMonthlyMaintenance` early-returns unless the Saigon day == `'01'` (`:222-223`). There is no cadence parameter. Build a focused `digestManager.ts` with its own cadence; reuse ONLY the `Intl.DateTimeFormat`/Asia-Saigon formatting idiom, not the monthly job.
- **Idempotency = unique-constraint upsert, NOT last-run timestamp.** The maintenance dedup is an atomic DB unique key `MaintenanceLog(channelId, kind, period)` with create-or-skip (`maintenanceManager.ts:227-230`), NOT a read-check-write on a timestamp. A "read last-run → compare window → write" guard is a classic race: on multi-process Neon two instances both read a stale last-run and both post. Copy the real pattern — a unique row per digest window (e.g. `DigestLog(kind, period)` with `@@unique([kind, period])`, or reuse `MaintenanceLog` with `kind:'digest'`, `period:'2026-W30'`) and `create`-or-skip on the unique violation. `setInterval` is per-process in-memory, so it is NOT single-instance safe — the unique row is what makes double-fire harmless.
- Query `RequestPost where status in (OPEN, CLAIMED)` ordered by age; `ShowcasePost` created since last digest window.
- Post target: a `config.channels.digest` (new) or reuse an existing highlight/chat channel.

## Related Code Files

- Create: `src/systems/digestManager.ts` (focused new manager <200 lines — there is no reusable scheduler to extend).
- Modify: `src/config.ts` (channels.digest, digest cadence), `prisma/schema.prisma` (new `DigestLog` model with `@@unique([kind, period])`, OR reuse `MaintenanceLog` with `kind:'digest'`), `src/events/ready.ts` (start the digest timer).
- Reference: `maintenanceManager.ts:222-248` (tz-formatting idiom + MaintenanceLog dedup pattern — copy the idiom, NOT the monthly job), `requestManager.ts` (open-request query shape), `showcaseManager.ts` (recent posts).

## Implementation Steps

1. Decide cadence (default weekly for a 50-300 server — daily risks noise). Confirm with user.
2. Add digest channel + cadence to config.
3. Build query for open requests + recent showcases.
4. Compose one embed with links; skip if empty.
5. Schedule via own `setInterval` in `digestManager.ts`; guarantee once-per-window with a UNIQUE-constraint row (`create`-or-skip on `(kind, period)`), NOT a last-run timestamp compare. This is what makes a per-process timer double-fire harmless.
6. Admin command to trigger digest manually for testing.

## Success Criteria

- [x] Digest posts on schedule with correct open-request + showcase list and working links.
- [x] No post when nothing is open/new.
- [x] Re-trigger within the same window does not double-post.
- [x] `npm run build` clean.

## Risk Assessment

- **Noise (MED):** default weekly, skip-when-empty. Let admin tune cadence.
- **Multi-instance double-post (LOW-MED):** guarded by a UNIQUE-constraint row per window (`create`-or-skip), NOT a last-run timestamp compare; matches the plan-wide "correct on single- and multi-process" rule from the prior hardening plan.
