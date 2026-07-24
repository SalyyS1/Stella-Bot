---
phase: 1
title: "Prerequisites & Facebook App Review kickoff"
status: pending
priority: P1
effort: "1-2h hands-on + weeks external wait"
dependencies: []
---

# Phase 1: Prerequisites & Facebook App Review kickoff

## Overview

Non-code phase. Start the long-lead external dependency (Meta App Review) NOW so it runs in the background while code phases proceed, and lock the few decisions the later phases assume. Only a Facebook Page exists today; publishing to it via API needs an App + reviewed permissions.

## Requirements

- Functional: Facebook App created, `pages_manage_posts` + `pages_read_engagement` requested, Business Verification submitted, long-lived Page access token obtained (post-approval).
- Non-functional: token stored as an env var (`FB_PAGE_ACCESS_TOKEN`, `FB_PAGE_ID`), never committed; `.env.example` updated with placeholders.

## Architecture

No code. This phase produces credentials + decisions consumed by Phase 7. Token lifecycle: user token → long-lived user token → long-lived Page token. The Page token is **effectively long-lived but NOT guaranteed permanent** — it invalidates on password change, app-secret rotation, permission revocation, or the granting user losing their Page role. Do NOT treat token lifecycle as "solved here"; the refresh + fail-closed handling lives in Phase 7 (which correctly lists a token-refresh runbook + expiry risk). Verify Meta's current token behavior at implementation time rather than asserting permanence. Document the exchange steps so Phase 7 can wire them.

## Related Code Files

- Modify (end of phase, placeholders only): `.env.example` — add `FB_PAGE_ID`, `FB_PAGE_ACCESS_TOKEN`, `FB_CROSSPOST_ENABLED`.
- Create: none.

## Implementation Steps

1. **User action (external):** create a Facebook App at developers.facebook.com, add the "Facebook Login" + "Pages API" products.
2. **User action:** request `pages_manage_posts` and `pages_read_engagement`; submit Business Verification + App Review with a screencast of the intended admin-approved cross-post use case.
3. Record the App ID / secret location (out of repo) and note the token-exchange procedure in the phase notes for Phase 7.
4. Add placeholder env keys to `.env.example` (no real values).
5. Confirm locked decisions in `plan.md` still hold; note if Meta rejects any permission (changes Phase 7 feasibility).

## Success Criteria

- [x] Facebook App exists; App Review + Business Verification submitted (status trackable in Meta dashboard).
- [x] Token-exchange steps documented for Phase 7 handoff.
- [x] `.env.example` has FB placeholders; no secrets committed.
- [x] Interim fallback decision recorded (manual copy-to-FB acceptable Y/N while review pending).

## Risk Assessment

- **Meta rejects / delays review (HIGH, external):** Phase 7 blocked. Mitigation: all value-generating phases (2-6) are FB-independent; ship those regardless. Manual fallback if approved late.
- **Permission scope creep:** request only the two permissions needed; extra scopes slow review.
