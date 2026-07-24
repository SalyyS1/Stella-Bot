---
phase: 5
title: "Reliability"
status: completed
priority: P2
dependencies: []
---

# Phase 5: Reliability

## Overview

Fix the runtime failure modes that don't corrupt data but degrade the bot: i18n read path issuing DB writes with an outage retry-storm, TTL-less i18n cache going stale, non-transactional global score wipe in backfill, unbounded in-memory maps (giveaway drafts, music cooldowns), and a few N+1 query loops.

## Key Insights

- `getGuildLocale` (i18n/index.ts:19-30) does a `prisma.guildSettings.upsert` on every cache miss — a *write* on a read path. On a DB outage it returns `'vi'` but doesn't cache the fallback, so every localized string re-fires a failing write → storm.
- Deployment topology (sharded vs single) is **unknown** (user answered "not sure"), so the cache fix must be safe for both: short TTL + write-through, no hard pub/sub dependency. `managedChannels.ts` already uses a 60s TTL pattern — mirror it.
- `voteBackfillManager.ts:265` zeroes all users' scores before recompute with no transaction — any later throw leaves everyone at 0.
- In-memory maps with no eviction: `giveawayDraftManager` draft Map, `musicManager` playCooldown Map (~16), `star.ts` huntLocks (already deletes in finally — ok).

## Requirements

- Functional: read path never writes; locale reflects changes within one TTL window in any topology; backfill never leaves scores zeroed on partial failure.
- Non-functional: bounded memory over long uptime; fewer redundant queries.

## Related Code Files

- Modify: `src/i18n/index.ts` (read via findUnique; TTL cache; write only in setGuildLocale)
- Modify: `src/systems/voteBackfillManager.ts` (transactional reset+recompute; drop N+1 status reads 257-260)
- Modify: `src/systems/giveawayDraftManager.ts` (sweep expired drafts)
- Modify: `src/systems/musicManager.ts` (evict playCooldown; playlist connect-once + collect failures, 303-311)
- Modify: `src/utils/managedChannels.ts` (retain last-known-good on refresh error, 28-40)

## Implementation Steps

1. **i18n read path (index.ts:19-30):** `getGuildLocale` uses `findUnique` (read). Missing row → return default `'vi'` and cache it. Only `setGuildLocale` performs the write (upsert). On DB error, cache the fallback with a short TTL so it doesn't storm.
2. **i18n TTL cache:** mirror `managedChannels` — store `{ value, loadedAt }`, expire after ~60s. This makes locale changes eventually-consistent across processes without requiring pub/sub, safe for sharded or single-process (resolves the unknown-topology question conservatively).
3. **Backfill transaction (voteBackfillManager.ts:265):** wrap the score reset + recompute in a single `prisma.$transaction`, OR compute all new per-user values first and write them without a global pre-zero. Never leave a window where all scores are 0.
4. **Backfill N+1 (voteBackfillManager.ts:257-260):** have `maybePublishShowcase` return whether it published instead of the before/after `findUnique` pair per message.
5. **Draft sweeper (giveawayDraftManager.ts):** add a `setInterval` sweep that deletes entries past `expiresAt`, or sweep opportunistically inside `saveGiveawayDraft`.
6. **playCooldown eviction (musicManager.ts:16):** prune expired entries on access, or use a TTL map.
7. **playlist loop (musicManager.ts:303-311):** connect once before the loop; collect per-track failures instead of throwing mid-loop; report `queued X / skipped Y`.
8. **managedChannels last-known-good (28-40):** on refresh error, don't overwrite cache or advance `cacheLoadedAt`; keep serving the previous good values.

## Todo List

- [ ] i18n read path no longer writes
- [ ] i18n cache has TTL
- [ ] Backfill reset+recompute transactional
- [ ] Backfill N+1 removed
- [ ] Draft map swept
- [ ] playCooldown map bounded
- [ ] Playlist connect-once + failure collection
- [ ] managedChannels retains last-known-good
- [ ] `npm run build` clean

## Success Criteria

- [ ] Read-only locale lookups issue zero DB writes (verify via query log or code inspection).
- [ ] Simulated DB outage during localized replies produces one fallback, not a per-call write storm.
- [ ] Backfill interrupted mid-run never leaves scores at 0 (recompute is atomic).
- [ ] Long-running process shows bounded draft/cooldown map size.

## Risk Assessment

- **Risk:** TTL cache serves stale locale for up to 60s after a change. **Mitigation:** acceptable; `setGuildLocale` write-through updates the local process immediately, TTL only bounds cross-process lag.
- **Risk:** wrapping backfill in one transaction lengthens the tx and can lock rows. **Mitigation:** prefer the compute-first-then-write approach if the guild is large; either avoids the all-zero window.

## Next Steps

Independent of Phases 1-4; can run in parallel. Feeds Phase 7 verification.
