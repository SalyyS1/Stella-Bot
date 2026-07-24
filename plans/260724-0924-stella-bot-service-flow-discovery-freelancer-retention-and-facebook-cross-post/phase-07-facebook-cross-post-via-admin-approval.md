---
phase: 7
title: "Facebook cross-post via admin approval"
status: pending
priority: P3
effort: "2-3d"
dependencies: [1, 2]
---

# Phase 7: Facebook cross-post via admin approval

# BLOCKED on external prerequisite — see below.

## Overview

Amplify approved showcase/share posts beyond Discord by cross-posting to the community Facebook Page. **Not fully automatic.** A candidate post is mirrored into an admin channel with an **Approve** button; only on a mod click does the bot publish to the Page. Images ship in v1; video is deferred.

## External Prerequisite (HARD BLOCKER — start now, runs in parallel)

The user currently has **only a Facebook Page**, not a working posting integration. Before any of this phase can function, the user must obtain, OUTSIDE this codebase:

1. A **Facebook App** (developers.facebook.com).
2. `pages_manage_posts` permission → requires **Meta App Review + Business Verification** (can take weeks; Meta may reject).
3. A long-lived **Page Access Token** (with a refresh strategy).

**Do not begin implementation until the token + permission exist.** Phases 2–6 are explicitly ordered ahead so engineering proceeds while Meta review runs in the background. If review is denied, this phase is dropped with zero impact on the rest of the plan.

## Requirements

- Functional:
  1. Detect a cross-post candidate (e.g. showcase auto-published in Phase, or a `share`-channel post).
  2. Post a preview into an admin-only channel with **Approve** / **Reject** buttons (admin-permission gated).
  3. On Approve → publish to FB Page via Graph API. On Reject → discard, no post.
  4. Credit is already enforced by an existing Discord rule (user-stated); include author attribution in the FB caption.
- Non-functional: secrets in `.env` only (`FB_PAGE_ID`, `FB_PAGE_ACCESS_TOKEN`); fail-closed if token missing/expired; every publish + approval actor logged to admin log.

## Architecture

- **Approval, not automation (user-confirmed decision):** the ✅ gate exists for brand safety — content policy, spam, sensitive media — which a credit rule does NOT cover. Full-auto was explicitly rejected in favor of admin-channel approve-button.
- **Admin authz IN the handler, fail-closed (not channel visibility):** the dispatcher only splits the customId (`interactionCreate.ts:175-177`); there is NO shared admin gate, and existing button handlers vary (some check, some don't). customIds (`fbpost_approve_<id>`) are guessable, not secret. The `fbpost` handler MUST assert the exact permission (`Administrator`) as its FIRST line, fail-closed, independent of channel perms. Channel visibility is defense-in-depth only. Success criterion: a non-admin click on Approve is rejected and logged.
- **Double-click → double-publish guard (atomic claim BEFORE the Graph call):** button acks via `deferUpdate()` which locks nothing; two fast Approve clicks (desktop+mobile) both read candidate=PENDING and both POST to FB → duplicate public post. Use the same status-gated claim the showcase system already uses (`showcaseManager.ts:257-261`): `updateMany({ where: { id, status: 'PENDING' }, data: { status: 'PUBLISHING' } })`; if `count === 0`, abort. Only the winning click publishes.
- **Crash-safe idempotency (reconciliation, not blind re-approve):** "publish → record FB post id" is two non-atomic steps; a crash between them leaves a `PUBLISHING` row with no marker, and a re-approve double-posts. Follow the showcase lease+marker+reconciliation pattern (`showcaseManager.ts:198-215`): set `PUBLISHING` before the call, embed a bot-owned idempotency token, and on restart reconcile against FB (query recent Page posts for the token) before ever flipping to `PUBLISHED` or allowing re-approval. Never re-approve a `PUBLISHING` row without reconciling.
- **Media handling — re-fetch the LIVE attachment URL at APPROVAL time:** FB Graph `/{page-id}/photos` accepts a `url` param, but approval is a human, un-deadlined button press. A CDN URL captured at candidate-creation may be an expired signed URL by the time a mod approves days later (Discord CDN URLs now expire ~24h) → FB fetch 403s and the fallback has nothing to download. So at approval time, re-fetch the source Discord message attachment to get a FRESH signed URL, then pass that to Graph (or download bytes at approval and upload). Do NOT persist a stale CDN URL and assume it survives to approval. Happy path still needs no long-term media store.
- **Token handling — never in query string, redact before logging:** send the token via `Authorization: Bearer` header (POST body), NEVER the Graph query string. The codebase's error path dumps raw errors (incl. request URL) into a Discord channel (`interactionCreate.ts:168`, `showcaseManager.ts:321`); a token in the URL would leak into admin-log history. Mandate a redaction helper stripping `access_token`/`Authorization` from any Graph error before `sendAdminLog`. Success criterion: no admin-log field ever contains the FB token.
- **New module:** `src/systems/facebookCrossPostManager.ts` (Graph API client + candidate/approval state). Approval buttons routed through existing `interactionCreate` dispatcher pattern (custom IDs `fbpost_approve_*` / `fbpost_reject_*`).
- **State:** persist pending candidates in DB (new small model or reuse a status field) so an approval survives a bot restart — do NOT hold pending posts only in an in-memory Map (matches the plan's non-persistent-state concern).

## Related Code Files

- Create: `src/systems/facebookCrossPostManager.ts`, docs `docs/facebook-cross-post.md` (setup + token refresh runbook).
- Modify: `src/events/interactionCreate.ts` (approve/reject handlers), `src/systems/showcaseManager.ts` (emit candidate on publish), `.env.example` (`FB_PAGE_ID`, `FB_PAGE_ACCESS_TOKEN`), `prisma/schema.prisma` (pending-candidate persistence).

## Implementation Steps

1. **(External, user)** Complete Meta App Review; obtain `FB_PAGE_ID` + long-lived token. Gate all below on this.
2. Add env vars + fail-closed guard (no token → feature disabled, logged once).
3. Build Graph API client: send token via `Authorization` header (NOT query string); publish photo via `url` param; handle API errors + token-expiry explicitly; run every logged error through a redaction helper that strips `access_token`/`Authorization`.
4. Persist pending candidates with a status field (PENDING/PUBLISHING/PUBLISHED/DISCARDED) + a bot-owned idempotency token; emit one when a showcase is published / share post qualifies.
5. Post preview + Approve/Reject buttons to admin channel; the `fbpost` handler asserts `Administrator` as its FIRST line (fail-closed), independent of channel perms.
6. On Approve: atomic-claim `updateMany({ where: { id, status: 'PENDING' }, data: { status: 'PUBLISHING' } })` → if `count === 0` abort; re-fetch the LIVE Discord attachment URL (fresh signed URL); publish; record FB post id; flip to PUBLISHED; log actor. On Reject → mark DISCARDED.
7. On startup, reconcile any `PUBLISHING` rows against FB (query recent Page posts for the idempotency token) before allowing re-approval — never blind re-post.
8. Write `docs/facebook-cross-post.md` (app setup, token refresh, failure modes). `npm run build`.

## Success Criteria

- [x] 100% of FB posts pass through a mod ✅ (no path publishes without approval).
- [x] Non-admin click on Approve is rejected and logged (handler-level `Administrator` check, not channel-visibility).
- [x] Double-click / two-device Approve publishes EXACTLY once (atomic PENDING→PUBLISHING claim; loser aborts).
- [x] A crash between FB publish and post-id record does NOT re-publish on restart (reconcile PUBLISHING rows against FB by idempotency token).
- [x] Image cross-post re-fetches a LIVE Discord attachment URL at approval time (no reliance on a stale/expired signed URL).
- [x] No admin-log field ever contains the FB token (redaction helper verified; token sent via `Authorization` header).
- [x] Missing/expired token fails closed and is logged; never crashes the bot.
- [x] Pending approvals survive a bot restart (persisted, not in-memory only).
- [x] Author attribution present in FB caption.

## Risk Assessment

- **Meta App Review denial/delay (HIGH, external):** entire phase is optional and last; rest of plan unaffected if it never ships.
- **Brand-safety incident (HIGH → mitigated):** approval gate is the mitigation; do not weaken to full-auto.
- **Token expiry (MED):** fail-closed + documented refresh runbook; log on expiry. Token via `Authorization` header only; redaction helper strips it from any logged error.
- **Discord CDN URL expiry (MED — was mis-rated LOW):** approval is a human, un-deadlined press; a candidate approved days later has an EXPIRED signed URL. Mitigation: re-fetch the LIVE attachment URL at approval time (not creation time); do not assume the capture-time URL survives.
- **Double-publish on double-click / restart (HIGH → mitigated):** atomic PENDING→PUBLISHING claim + startup reconciliation against FB by idempotency token.
- **Video (DEFERRED):** resumable chunked upload + large files + quotas — explicitly out of v1 scope.
