---
phase: 5
title: "Freelancer onboarding and reputation surfacing"
status: pending
priority: P2
effort: "2d"
dependencies: [2, 3]
---

# Phase 5: Freelancer onboarding and reputation surfacing

## Overview

Give new freelancers a reason to stay. Add an entry ritual (pick skill roles → post a portfolio → get a verified role) and pull the ALREADY-STORED reputation data (`expertScore`, `contributionScore`, `RequestReview` ratings) out of the DB and onto visible leaderboards + profile badges. This is the real "game" for a service community — retention through status, not mini-games.

## Requirements

- Functional:
  1. New-member onboarding path: select skill roles (reuses Phase 3 skill-role picker) → prompt to create a portfolio post → award a "Verified Freelancer" role after first portfolio, GATED behind a mod approval press (not auto-grant — a single self-authored portfolio must not self-verify).
  2. Freelancer leaderboard command: rank by average `RequestReview.rating` and completed-job count (min N reviews to appear, avoid 1-review 5.0 gaming).
  3. Profile card enrichment: show avg rating, jobs completed, contribution score, verified badge (extend existing `profile` / `cardRenderer`).
- Non-functional: no new gambling/economy loops; read-mostly aggregations; respect existing card renderer perf. Persist a member join timestamp so retention metrics are computable (none exists today).

## Architecture

- **Reputation source (all existing):** `RequestReview` (rating, targetId), `User.contributionScore`, `User.expertScore`. No schema change needed for leaderboard — aggregate `RequestReview` by `targetId` (`schema.prisma` has `@@index([targetId])`, leaderboard-ready).
- **Verified role (must be BUILT at ready-time — there is NO reusable bootstrap):** `ready.ts:10-17` creates zero roles; `updateLevelRole` (`xpManager.ts:119`) is lazy/level-up-triggered/name-matched, so "reuse level-role bootstrap" reuses nothing. Add a `ClientReady` pass that creates the verified role if missing and PERSISTS its ID to `ManagedChannel` (config.ts is static). Share the same startup reconciliation added in Phase 3 for skill roles.
- **Verified role GATE (not auto-grant on first post):** do NOT auto-grant on a single self-authored portfolio (unvetted privilege escalation — a spam/alt account clears it with junk). Gate behind EITHER a mod approval press (reuse the Phase 7 approve-button pattern) OR a reputation threshold (≥N genuine completed+reviewed jobs from DISTINCT requesters). User accepted "small community, trust-based" for anti-collusion, so a light mod-approval press is the chosen gate here (cheapest vetting, not full anti-sybil).
- **First-portfolio detection (no existing mechanism):** portfolios are created via the `portfolio_modal` submit handler (`interactionCreate.ts:400`), NOT a channel scan, and there is no per-user portfolio-count tracking. "First portfolio" needs new state: either query `count(portfolio posts by author) === 0` before granting, or add a `hasPortfolio`/`verifiedAt` flag on `User`. Hook the modal-submit handler, do not scan a channel.
- **Onboarding trigger (net-new, NOT an extension):** `guildMemberAdd.ts:8-46` is a static welcome-embed sender with no buttons/state; adding skill-role buttons + portfolio CTA is new work, scope it as such. Discord does NOT replay joins after downtime — add a `/verify` or onboarding entry command (or a startup backfill) so members who joined while the bot was down can still onboard.
- **Metric persistence (for plan success criteria):** "new freelancers active after 7 days" is NOT computable today — `guildMemberAdd` never persists join time to `User` and there is no `joinedAt` field. To measure retention, persist a join/first-seen timestamp on `User` on join (and backfill on first activity for existing members), else downgrade that metric to "instrument later."
- **Leaderboard:** new subcommand on existing `top` command (e.g. `/top freelancers`) or a `request` subcommand — extend, do not add a new top-level command (DRY). NOTE: with "no freelancer retained" today the board starts near-empty — enforce a min-reviews floor so it isn't a demotivating 1-review 5.0 board.
- **Profile:** extend `cardRenderer` + `profile` command with rating/jobs fields.

## Related Code Files

- Modify: `src/config.ts` (roles.verifiedFreelancer catalog key — ID persisted at runtime, not here), `src/events/ready.ts` (verified-role creation in the SAME ClientReady reconciliation added by Phase 3), `src/events/guildMemberAdd.ts:8-46` (net-new interactive onboarding — currently static welcome only), `src/events/interactionCreate.ts:400` (`portfolio_modal` submit handler — hook first-portfolio detection HERE, not a channel scan), `src/commands/top.ts` OR `src/commands/profile.ts` (leaderboard + badge), `src/systems/cardRenderer.ts` (rating/jobs on card), `prisma/schema.prisma` (add `User.joinedAt`/`firstSeenAt` + optional `verifiedAt`/`hasPortfolio` for first-portfolio + retention metric).
- Reference: `giveawayManager.ts:189` (safe fixed-role-ID mention). NOTE: `xpManager.ts` has NO reusable role bootstrap — `updateLevelRole` is lazy/name-matched; ready-time role creation is new code shared with Phase 3.

## Implementation Steps

1. Add verified-freelancer role to the Phase-3 `ClientReady` reconciliation (create-if-missing + persist ID to `ManagedChannel`). There is no level-role bootstrap to reuse.
2. Onboarding is NET-NEW: extend static `guildMemberAdd` into a welcome prompt → skill-role buttons (Phase 3) → "post your first portfolio" CTA. Add a `/verify`/onboarding command (or startup backfill) so members who joined during downtime can still onboard (Discord does not replay joins).
3. Persist `User.joinedAt` on join (backfill on first activity for existing members) so the 7-day-retention metric is computable.
4. Hook the `portfolio_modal` submit handler (`interactionCreate.ts:400`): on a user's FIRST portfolio (query count === 0 or a `hasPortfolio` flag), route to the verified-role GATE — a mod approval press (Phase-7 button pattern), NOT auto-grant.
5. Build freelancer leaderboard aggregation (avg rating + job count, min-reviews floor to block 1-review 5.0 gaming).
6. Add `/top freelancers` (or equivalent) subcommand rendering it.
7. Enrich profile card with rating/jobs/badge.
8. `npm run build`.

## Success Criteria

- [x] New member can go welcome → skill roles → portfolio → verified role, where the verified role requires a mod approval press (no auto-grant on a single self-authored portfolio).
- [x] Members who joined during downtime can still onboard via `/verify`/entry command (join event is not replayed).
- [x] `User.joinedAt`/first-seen is persisted so the 7-day retention metric is actually computable (or that metric is explicitly downgraded to "instrument later").
- [x] Leaderboard ranks freelancers by rating + jobs, ignores sub-threshold sample sizes (min-reviews floor).
- [x] Profile card shows avg rating, jobs done, verified badge.
- [x] `npm run build` clean.

## Risk Assessment

- **Rating gaming (MED):** min-reviews floor + rating already gated one-per-request by the atomic guard. Do not rank on a single review.
- **Unvetted verified role (MED → mitigated):** verified role is mod-approval-gated, not auto-granted on first portfolio; a junk/alt post cannot self-verify.
- **Missed onboarding on downtime (MED):** `guildMemberAdd` is live-only; add `/verify`/entry command or startup backfill so downtime joins still onboard.
- **Retention metric not computable (MED):** no `joinedAt` exists today; persist it on join + backfill, or downgrade the metric — do not claim a number the schema can't produce.
- **Scope creep into full profiles (MED):** keep to rating/jobs/badge; no new economy loops (YAGNI).
