---
name: red-hat-team-review-giveaway-star-request-music
type: red-hat-code-review
range: 1197c2d..4c55e7d
created: 2026-07-06T20:15:00+07:00
reviewers: agent-team (5 streams) + controller direct review
status: DONE_WITH_CONCERNS
---

# Red-Hat Review — Stella Bot (1197c2d..4c55e7d, 10 commits, ~2200 LOC)

Adversarial review. 5 parallel reviewers over subsystem clusters; star/showcase/request
cluster reviewed directly by controller after 2 agent timeouts. Global
`unhandledRejection` handler (index.ts:46) exists, so bugs below log-spam + show users
"interaction failed" / cause data corruption rather than hard-crash.

## CRITICAL (fix before ship)

### C1. Request rating = unlimited Scoin printing — requestManager.ts:233-266
`rateRequest` has **no status guard**. Checks exist/requester/claimedById only; never
rejects already-`RATED`. Scoin reward (`user.update increment scoinBalance` :248, +
`scoinTransaction.create` :256) runs **every call**, while `requestReview.upsert` only
dedups the review row. Rate-message buttons (ratingButtons, :183) are never disabled after
use. Requester spam-clicks the 5-star button → target gets `rating*10` Scoin per click,
infinitely. **Money printer.**
Fix: guard `if (request.status === 'RATED') throw` at top; disable rate buttons after first
rate; make the transition atomic (`updateMany where status != RATED`, reward only if count==1).

### C2. Star `sell` double-payout (TOCTOU) — star.ts:336-349
`inventoryValue` (total) computed OUTSIDE the tx (:338); tx zeroes inventory + credits the
**stale** `total` (:347). Two concurrent `/star sell` both read the same total, both zero,
both credit → 2× Scoin for 1× inventory. Classic economy dupe.
Fix: recompute value inside the tx from freshly-read rows, or gate with a conditional
update and credit only the actually-cleared amount.

### C3. Giveaway double-end race — giveawayManager.ts:231-256
`endGiveaway` read-modify-write with no atomic status flip. Scheduler tick (`setInterval`,
non-awaited, :323) + manual `/giveaway end` both read `ACTIVE`, both draw, both DM winners,
both write `GiveawayRewardDelivery`. Long draws (>45s) let the next tick re-end the same
rows. Double DMs / double reward delivery.
Fix: `updateMany({ where:{ id, status:'ACTIVE' }, data:{ status:'ENDED' }})`, proceed only
if `count===1`; add in-flight guard to the scheduler.

### C4. Giveaway `reroll` bypasses status guard — giveawayManager.ts:234
`if (!reroll && status !== 'ACTIVE') throw` → reroll skips the check entirely. `/giveaway
reroll` on a **CANCELLED** giveaway draws winners, DMs them, overwrites status to `ENDED`.
Already-refunded participants "win" again.
Fix: reroll must require `status === 'ENDED'`.

### C5. Showcase double-publish (TOCTOU) — showcaseManager.ts:189-268
Status checked `!== 'VOTING' return` (:202); status flipped to `PUBLISHED` only after
thread creation (:261). Reaction-triggered `maybePublishShowcase` races the scheduler's
`publishEligibleShowcases` loop (:320) → both pass the guard, both create forum threads,
both DM author. Duplicate featured threads.
Fix: atomic `updateMany where status='VOTING'` claim before creating the thread; create only
if the claim succeeded.

### C6. Committed default Lavalink password + bind-all — lavalink-host/application.yml:3,13
`address: 0.0.0.0` + `password: "${LAVALINK_SERVER_PASSWORD:change_me_lavalink_password}"`.
Forgot-to-set-env deploy boots a public Lavalink on :2333 with a password that is public in
the repo. Shipped in the host package → open relay for stream-ripping / bandwidth DoS.
Fix: drop the default (`${LAVALINK_SERVER_PASSWORD}` — fail closed); bind `127.0.0.1` when
co-hosted.

## IMPORTANT

- **I1. Request buttons never defer** (interactionCreate.ts:267-306) — slow DB+refresh work
  before reply blows the 3s token window → 10062 + unhandled rejection. Giveaway branch was
  fixed with `safeDeferEphemeral`+`.catch`; request branch was not. Mirror it.
- **I2. `return interaction.reply(...)` (no await) inside try** (multiple, e.g. :275,285,295)
  — rejections escape the surrounding catch → unhandled. Use `return await ....catch(()=>{})`.
- **I3. Empty-but-present form field crashes request post** (messageCreate.ts:166-214) —
  `includes('[Service]')` checks presence not content; empty value → embed build throws
  AFTER the DB row is created and the user's message deleted → orphan row + data loss.
- **I4. Claim last-writer-wins race** (requestManager.ts:146-167) — unconditional update;
  two claimers both "win", first silently displaced. Use `updateMany where status='OPEN'`.
- **I5. i18n read path issues a DB WRITE** (i18n/index.ts:19-30) — `getGuildLocale` upserts
  on every cache miss; on DB outage the fallback isn't cached → failing-write storm. Use
  `findUnique`; create only in `setGuildLocale`.
- **I6. i18n cache has no TTL / cross-process invalidation** (i18n/index.ts:4,25) — sharded
  deploy serves stale locale forever. `managedChannels` already solved this with a TTL; i18n
  is the inconsistent one.
- **I7. Non-transactional global score wipe** (voteBackfillManager.ts:265) — `updateMany
  { expertScore:0, contributionScore:0 }` on ALL users, then recompute; any later throw
  leaves everyone at 0. Wrap in one `$transaction` or compute-then-write.
- **I8. Paid entrants disqualified at draw** (giveawayManager.ts:244→172) — `checkRequirements`
  re-checks `entryCost`/`minScoin` at end time; a user who paid but later dropped below
  balance is excluded → paid, can't win. Don't re-validate cost at draw.
- **I9. SSRF via `http: true`** (application.yml:20 + musicManager.ts:206,239) — user
  `s!play http://169.254.169.254/...` makes the Lavalink host fetch internal URLs. Set
  `http: false` or block private/link-local ranges.
- **I10. No same-voice-channel authz on playback control** (musicManager.ts:248) — any member
  can stop/skip another room's music. Check `member.voice.channelId === player.voiceChannelId`.
- **I11. Draft map leak** (giveawayDraftManager.ts:15-31) — abandoned modals never swept;
  unbounded growth. Add periodic/opportunistic sweep.
- **I12. Reroll accumulates winners** (giveawayManager.ts:251) — each reroll appends a full
  `winnersCount` batch (3→6→9). Confirm intended (replace vs add).
- **I13. Unguarded giveaway modal-create path** (interactionCreate.ts:514-551) — defers then
  calls throwing `parseDuration`/`createGiveaway` with no try/catch → hung deferred reply.

## MINOR (high-signal subset)

- Scoin balance checks outside tx in star buy/upgrade & giveaway join (TOCTOU overspend if
  `adjustScoinTx` doesn't guard negative — **verify** `scoinManager.adjustScoinTx`).
- Music: `playCooldown`/`huntLocks` maps never evicted; `executeMusicSlash` `return null`
  hangs interaction; health panel leaks node host:port to any user.
- Backfill N+1 status reads per showcase (voteBackfillManager.ts:257-260).
- `managedChannels` refresh error masks overrides for 60s (don't advance cacheLoadedAt on error).
- Portfolio text-form handler dead code (messageCreate.ts:226-247); `levelUp` no longer
  auto-cleaned — confirm intent.
- start.sh downloads Lavalink.jar with no checksum; HOST_README uses `npm install` (not `ci`)
  on every boot.

## Verified NON-ISSUES (checked, no action)
- Migration safe on populated DB: all guarded (`IF NOT EXISTS` / `pg_constraint`), NOT-NULL
  cols only on new tables, no DROPs, `pingRoleId` nullable.
- Authz present: giveaway-create=Admin, close/bump=author-admin, announce=creatorId,
  `/language set`=Admin, request rate gated to requester.
- Mention injection blocked (`allowedMentions` scoped to requester).
- customId parsing NaN-guarded; `getPart` regex not ReDoS-able.
- `pickWinners` selection is unbiased, dedups, handles empty/short pools.
- Host package does NOT ship `.env`/secrets/db files (verified copyFiles + shouldSkip).
- Long giveaway durations don't overflow setTimeout (DB-polling scheduler).

## Unresolved questions
1. Does `scoinManager.adjustScoinTx` reject negative balances inside the tx? Gates severity of
   multiple TOCTOU overspend findings.
2. Is the bot deployed sharded/multi-process? If yes, I6 is a correctness bug not theoretical.
3. Reroll semantics: add a full batch each call, or replace/top-up? (I12)
4. Is Lavalink co-hosted with the bot (→ bind 127.0.0.1) or a separate public node? (C6 framing)
5. Is `http: true` deliberate (direct-URL streaming) or a copy-paste default? (I9)
6. Portfolio text-form + `levelUp` auto-delete removal intentional?
