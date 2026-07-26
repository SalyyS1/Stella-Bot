---
name: parallel-codebase-audit-stell-bot
created: 2026-07-26T11:38:04Z
updated: 2026-07-26T11:38:04Z
---

# Edge Case Verification Report — STELL Bot (parallel codebase audit)

Scope: full `src/` (~10.2k LOC). 6 parallel code-reviewers verified 44 pre-identified edge cases + surfaced 10 extra findings. 8 critical/important candidates adversarially re-verified (5 CONFIRMED, 3 REFUTED). Run `wf_4608f39e-082`, 14 agents, ~1.26M tokens.

## Summary

- Total edge cases assigned: 44
- Handled: 29 | Not-applicable: 5 | Partial: 9 | Unhandled: 1
- Extra findings discovered: 10
- After adversarial verification: **0 critical, 5 confirmed important, ~19 minor**
- Strongest subsystems: star game (7/7 clean), economy money paths (atomic updateMany + balance guard, ledger in same tx, tested), giveaway end/recovery state machine (atomic status CAS), vote score (advisory lock + unique constraints), request claim (tx + status guard).

## CONFIRMED — Important (ALL 5 FIXED, verified: `tsc --noEmit` clean + self-check 31/31)

Fixes applied 2026-07-26:
1. `imageGenClient.ts` — outer abort signal now threaded into `extractImage`'s URL fetch.
2. `interactionCreate.ts:347/570/656` — showcase optout/tag/title now defer-first (safeDeferUpdate/safeDeferEphemeral), replies via editReply/safeInteractionReply.
3. `interactionCreate.ts` close/bump — wrapped in try/catch with user-facing error; bump reposts BEFORE deleting (no more permanent post loss).
4. `antiRaidManager.ts` — wired previously-unused `config.roles.trusted` as punishment exemption (`trusted-role-exempt`); events still logged; self-token path unaffected; automated rollback/restore still runs.
5. `adminLog.ts` — all swallow paths now console.error with embed title (channel unavailable, send failure, unexpected error); never-throw guarantee kept.

## Original findings

| # | Finding | Location | Failure path |
|---|---------|----------|--------------|
| 1 | Inner image-URL fetch has no abort signal; outer 120s timer aborts a controller not attached to it | `src/systems/imageGenClient.ts:65` | Gateway returns `data[0].url` to slow host → fetch bounded only by undici ~300s (unbounded w/ byte-trickle) → holds 1 of 2 global image slots (`imageManager.ts:47-55`, maxConcurrent 2) → `/imagine` blocked server-wide, deferred replies hang |
| 2 | Showcase optout/tag/title paths do DB work + awaited adminLog send BEFORE first interaction ack | `src/events/interactionCreate.ts:347` (also `:570`, `:656`) | botLog channel rate-bucket exhausted → awaited `channel.send` queues >3s → ack window expires (10062) → DB persisted but user sees "interaction failed", stale buttons. Sibling handlers (L465, L494) already defer-first with comments naming this exact bug class |
| 3 | close/bump button branch has no try/catch; post deleted then `channel.send` throws → permanent data loss | `src/events/interactionCreate.ts:556` | Bot loses SendMessages in portfolio channel → bump: `message.delete()` succeeds, repost `channel.send` throws 50013 → uncaught → eventHandler logs only → user's post permanently deleted, no repost, no feedback |
| 4 | Anti-raid: no human allowlist, no undo/pardon path, no account-age recheck before punish | `src/systems/antiRaidManager.ts:157` | Legit staffer creates 3 channels in 60s (threshold `config.ts:207`) → `punishActor` bans + deletes 3rd channel; `hasInternalAllow` only guards bot-self actions; `config.roles.trusted` exists but referenced nowhere; no unban/strike-clear command |
| 5 | adminLog swallows ALL failures with zero fallback (no console.error, no DB row, no startup validation) | `src/utils/adminLog.ts:29` (`:13`, `:14`, `:30-32`) | botLog misconfigured/deleted → punishment-failed events and "CRITICAL: Stella self-action blocked" alerts (`antiRaidManager.ts:195`) leave zero trace anywhere; operators can never discover pipeline is broken |

## REFUTED (adversarial verification; downgraded to minor hygiene)

- **Facebook/others fetch w/o timeout** — bounded by undici 300s defaults; approveCrossPost self-heals (PUBLISHING→PENDING revert + retry buttons within 15-min deferred window); reconcile on startup. Residual: add `AbortSignal.timeout()` as hygiene.
- **Prompt injection (Q&A/memory/wiki)** — system prompt contains no secrets (key only in header, redacted logs); MemberFacts self-scoped (`@@unique([userId, fact])`, loaded per-asker only); no `tools` param, output tool-syntax stripped; wiki admin-gated + SSRF-guarded. Residual: inherent-LLM off-persona replies to the injector only.
- **Missing defer in /announce** — zero awaits before first reply (all synchronous option/permission/Map ops); giveaway create must NOT defer (showModal requires unacked). Only real pre-ack await: `add.ts:32` single indexed upsert (minor).

## Minor findings (not blocking; opportunistic fixes)

1. `xpManager.ts:80` — cooldown check-then-set race (double XP in burst); `xpCooldowns` Map unbounded.
2. `game.ts:6`, `aiQaManager.ts:11` — cooldown Maps never pruned (slow unbounded growth).
3. `top.ts:58` — no stable tie-breaker in orderBy; ex-members still listed.
4. `trivia-manager.ts:53` — `startOfToday()` assumes host TZ = Asia/Saigon (undocumented deploy assumption).
5. `giveawayManager.ts:324` + `schema.prisma:246` — reward-delivery retry check-then-create not atomic, no `@@unique([giveawayId,userId])`; duplicate DMs possible (no money involved).
6. `giveawayDraftManager.ts:15` — drafts in-memory; restart mid-modal → "form expired".
7. `member-memory-manager.ts:47` — PII exclusion enforced by AI instruction only, no hard validation.
8. `imageGenClient.ts:58` — no upper bound on image size vs Discord 25MB limit → generic error.
9. `aiClient.ts:157` — no retry/backoff anywhere on 429/5xx (transient failure kills the request; next trivia tick 30 min).
10. `schema.prisma:344` — `TriviaWin` model dead code (wins tracked via ScoinTransaction).
11. `aiQaManager.ts:176` — compromised wiki page could carry adversarial text into prompt (admin-gated).
12. `messageCreate.ts:169` — `processMessageXp(...).catch(() => {})` swallows DB failures silently.
13. `musicManager.ts:137/220` — node-disconnect mid-track relies on autoReconnect + 30s destroy timeout; queueTrack doesn't check node connectivity → cryptic error.
14. `maintenanceManager.ts:100` — `setPosition`/`setName` `.catch(()=>{})` swallow rate-limit failures silently.
15. `requestManager.ts:310` — ledger row lacks idempotency key (theoretical under tx-retry only).

## Verification notes

- `/steal` is emoji-stealing, not currency theft — economy edge case N/A.
- StarTool has no durability field; StarHarvestSession is a log, not state — by design.
- Component authorization audit across `interactionCreate.ts`: all state-mutating branches re-check permissions/ownership server-side at click time — clean.
- Money-flow concurrency covered by `tests/money-flow-concurrency.test.ts`.

## Unresolved questions

1. Anti-raid: is ban-on-threshold for staff intentional (anti-nuke posture) or should `config.roles.trusted` be wired into the guards? Product-intent call.
2. adminLog: preferred fallback — console.error only, or DB audit table?
