---
title: "Stella Bot: Service-flow discovery, freelancer retention, and Facebook cross-post"
description: "Turn Stella from a feature-pile into a service-community engine: fix where service posts die (structured skill tags + skill-role match-ping), retain freelancers (onboarding + surfaced reputation + economy rebalanced toward service actions), and safely amplify reach (admin-approved Facebook Page cross-post). Money-flow smoke tests land first as a safety net."
status: pending
priority: P1
branch: "main"
tags: [engagement, service-flow, retention, facebook, discord]
blockedBy: []
blocks: []
created: "2026-07-24"
createdBy: "ak:plan"
source: skill
---

# Stella Bot: Service-flow discovery, freelancer retention, and Facebook cross-post

## Overview

Stella already has more features than a 50-300 member community can absorb; nothing "sticks" yet. This plan does NOT add another mini-game. It fixes the real problem surfaced in the advisory interview: this is a **creative/service** community whose heart is the request/showcase flow, but posts **die in low-traffic channels** ("đăng nhưng không khớp") and **no freelancer is retained**.

Strategy, cheapest-impact-first:
1. **Safety net** — the bot just patched 6 CRITICAL money/state bugs with zero automated tests. Add smoke tests over the money paths BEFORE stacking new systems on them.
2. **Discovery** — add a structured **skill enum** on requests (reusing the existing `service` field, no Forum migration — see Phase 3 route B), add self-assign **skill roles**, and **match-ping** the right role when a skill-tagged request appears. This directly fixes "not matched / nobody notices."
3. **Retention** — onboarding ritual for new freelancers, surface the reputation data the bot already stores (`contributionScore`, `RequestReview` 5-star), and **rebalance Scoin/XP rewards toward service actions** instead of chat + `/star`.
4. **Amplify** — Facebook Page cross-post, **admin-approval gated** (post lands in an admin channel; a button press publishes). No full-auto.

### Relationship to prior plan
`plans/260706-2046-stella-bot-hardening-and-ux/` (phases 1-5 done; 6-7 open) hardened the same managers this plan builds on. Not a hard blocker (critical fixes shipped), but Phase 2 here (money-flow smoke tests) **closes the runtime-verification gap** that plan's Phase 7 left open. Soft dependency only.

### User decisions locked (from advisory + plan interview)
- **Cross-post gate:** admin-channel review → button press → publish. NOT full-auto. (User initially wanted full-auto citing "credit rule"; corrected — credit ≠ brand-safety. User agreed to approval gate.)
- **Test-first:** write money-flow smoke tests before new systems. Confirmed.
- **Facebook readiness:** only a Page exists today. No FB App / App Review / `pages_manage_posts` yet → Phase 7 is **blocked on Meta App Review** (weeks, external). Kick off in Phase 1, build Phase 7 code only when approved.
- **Website:** explicitly **descoped**. Facebook Page + Discord are the storefront. Revisit only if cross-post proves demand.
- **Media storage:** try Graph API `url` param (FB fetches Discord CDN link directly) → likely **no download/storage needed** for images. Video deferred.
- **Single-guild:** bot is hardcoded single-guild in `config.ts`; this plan stays single-guild (no multi-tenant scope).

## Phases

| # | Phase | Status | Priority | Depends |
|---|-------|--------|----------|---------|
| 1 | [Prerequisites & Facebook App Review kickoff](./phase-01-start.md) | Pending | P1 | — |
| 2 | [Money-flow smoke test safety net](./phase-02-money-flow-smoke-test-safety-net.md) | Pending | P1 | — |
| 3 | [Forum board, tags, skill-role match-ping](./phase-03-forum-board-tags-skill-role-match-ping.md) | Pending | P1 | 2 |
| 4 | [Periodic digest of open requests and showcases](./phase-04-periodic-digest-of-open-requests-and-showcases.md) | Pending | P2 | 3 |
| 5 | [Freelancer onboarding and reputation surfacing](./phase-05-freelancer-onboarding-and-reputation-surfacing.md) | Pending | P2 | 2 |
| 6 | [Rebalance economy toward service actions](./phase-06-rebalance-economy-toward-service-actions.md) | Pending | P2 | 2 |
| 7 | [Facebook cross-post via admin approval](./phase-07-facebook-cross-post-via-admin-approval.md) | Pending | P2 | 1,2 |

## Dependencies

- **Phase 1** (non-code: Meta App Review kickoff + decisions) runs immediately and in the background; only Phase 7 waits on its outcome.
- **Phase 2** (smoke tests) is the safety net; every code phase after it relies on the money paths staying green. Do first among code phases.
- **Phase 3** depends on Phase 2 (touches request creation/lifecycle paths).
- **Phase 4** depends on Phase 3 (digest reads Forum/tag structure).
- **Phase 5, 6** depend only on Phase 2; independent of 3/4, can run in parallel with each other if file ownership stays separate (5 = onboarding/profile surfaces, 6 = reward sources).
- **Phase 7** depends on Phase 1 (Meta approval) + Phase 2. Build last; may sit blocked on Meta regardless of code readiness.

## Success Criteria (plan-level)

- [ ] Money-flow smoke tests exist and pass; a deliberately reverted atomic guard makes a test fail (net actually catches regressions).
- [ ] Request/showcase posts are filterable by tag and the matching skill-role gets pinged on new tagged posts.
- [ ] % of requests claimed within 24h ≥ 60% (queryable from `RequestPost.createdAt` vs `RequestClaim.createdAt`, but requires a reporting query/command — build it in Phase 5 or downgrade to "instrument later").
- [ ] Median time from post → claim drops ≥ 50% vs pre-change baseline (same reporting-query dependency as above).
- [ ] New freelancers active after 7 days (≥1 post/claim/showcase) ≥ 40% — NOT computable today (no `User.joinedAt`); depends on the join-timestamp persistence added in Phase 5. If that persistence is descoped, this metric is descoped with it.
- [ ] Scoin/XP reward weight shifts measurably toward service actions (job complete, good review, showcase voted) vs chat/`/star`.
- [ ] Every Facebook post passes through an admin approval press; 0 auto-published items.
- [ ] `npm run build` stays tsc-clean across all phases.

## Open Questions

- Meta App Review timeline and approval are outside our control — Phase 7 may stay blocked indefinitely; is a manual "admin copies to FB" fallback acceptable in the interim? (User kept FB in scope, deferred — fallback assumed acceptable while review pends.)
- Should `/star` rewards be reduced (deflate) or left alone while service rewards are raised (inflate)? Economy balance choice deferred to Phase 6 detail (default: ADD service rewards, do not nerf `/star`).
- ~~Forum migration archive vs hard-cut~~ — RESOLVED by red-team: route A (Forum migration) dropped; Phase 3 commits to route B (skill enum on existing `service` field). No channel migration.

## Red Team Review

### Session — 2026-07-24
**Reviewers:** 4 (Security Adversary, Failure Mode Analyst, Assumption Destroyer, Scope & Complexity Critic) — Full tier (7 phases).
**Findings:** 16 after dedup (all passed evidence filter — every finding cited `file:line`).
**Severity breakdown:** 5 Critical, 8 High, 3 Medium.
**Disposition:** 13 Accept (applied inline), 3 Reject (user-owned scope/trust decisions, recorded as trade-offs).

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | Test-DB string-equality guard can't catch shared Neon DB → `truncateAll` may wipe prod | Critical | Accept | Phase 2 |
| 2 | `tsx` runtime is fiction; repo is CommonJS + `ts-node` — test command can't run as written | Critical | Accept | Phase 2 |
| 3 | New `skill`/`budgetBand` columns duplicate existing `service`/`budget` fields | Critical | Accept | Phase 3 |
| 4 | Phase 7 Approve double-click → double-publish to FB (no atomic claim) | Critical | Accept | Phase 7 |
| 5 | Crash between FB publish and post-id record → re-publish on restart | Critical | Accept | Phase 7 |
| 6 | "Auto-create roles on ready" bootstrap does not exist (`ready.ts`/`xpManager` lazy+name-matched) | High | Accept | Phase 3, 5 |
| 7 | Phase 3 targets wrong files (`request.ts` is read-only; real path = `interactionCreate.ts`+`messageCreate.ts`) | High | Accept | Phase 3 |
| 8 | Phase 4 idempotency mis-specified (last-run timestamp race vs real unique-constraint upsert) | High | Accept | Phase 4 |
| 9 | FB token leaks into admin-log via raw-error logging pattern | High | Accept | Phase 7 |
| 10 | Two-account collusion mints Scoin; Phase 2 concurrency-only tests pass falsely | High | **Reject** | — (trade-off) |
| 11 | Phase 6 claimer can self-complete to farm reward (stacks on `rating*10`) | High | Accept | Phase 6 |
| 12 | Free-text skill → role injection / mass-ping (must be closed enum + fixed ID) | High | Accept | Phase 3 |
| 13 | Phase 2 harness oversized (load-test framing vs real double-click threat) | High | Accept | Phase 2 |
| 14 | Auto-grant Verified role on first portfolio = unvetted privilege escalation | Medium | Accept | Phase 5 |
| 15 | Migration leaves existing requests null-skill, no backfill, match-ping skips backlog | Medium | Accept | Phase 3 |
| 16 | Phase frontmatter `dependencies` contradict plan.md table (Phase 2 wrongly `[1]`) | Medium | Accept | Phases 2,3,5,6,7 |

### Rejected findings (user-owned decisions — recorded as accepted trade-offs)
- **Cut Facebook (Phase 1+7)** (SC Finding 4) → **Reject.** User chose "keep but defer." Trade-off accepted: weeks of Meta App Review lead time + integration cost to replace a manual copy-paste; mitigated by ordering FB last and shipping phases 2-6 independently. Double-publish/token/CDN mechanics still hardened (Findings 4,5,9).
- **Collapse engagement phases 4/5/6 to one** (SC Finding 1/6) → **Reject.** User chose "keep all, fix bugs." Trade-off accepted: three engagement mechanisms for a small population may dilute attention; revisit if none reaches critical mass. All three had their mechanical bugs fixed regardless.
- **Add anti-collusion before amplifying rewards** (SA Finding 3) → **Reject.** User chose "not yet — small, trust-based community." Trade-off accepted & documented in Phase 6 risk: cross-account post→claim→complete→rate can mint Scoin/rank; guard is deferred, self-complete farming (Finding 11) still blocked as the minimum. Revisit if community grows or abuse appears.

### Whole-Plan Consistency Sweep
- Files reread: plan.md + phase-01..07.
- Decision deltas checked: 13 (applied findings) + 3 (rejected trade-offs).
- Reconciled stale references: dependency graph (frontmatter ↔ plan.md table now aligned; Phase 2 `dependencies: []`, Phase 3 `[2]`, Phase 5 `[2]`, Phase 6 `[2]`, Phase 7 `[1,2]`); "reuse bootstrap/scheduler" claims corrected across Phases 3/4/5; `tsx`→`ts-node` across Phase 2; retention metric tied to Phase 5 `joinedAt`.
- Unresolved contradictions: 0.

<!-- slug: stella-bot-service-flow-discovery-freelancer-retention-and-facebook-cross-post -->
