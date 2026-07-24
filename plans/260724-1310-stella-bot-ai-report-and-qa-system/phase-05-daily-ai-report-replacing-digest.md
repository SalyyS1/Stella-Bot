---
phase: 5
title: "Daily AI report replacing digest"
status: pending
priority: P2
effort: "2-3d"
dependencies: [2]
---

# Phase 5: Daily AI report replacing digest

## Overview
A nightly (21-22h Saigon) AI-written community report posted to the forum channel `1530077329102078042`. It reads the last 24h of chat from a fixed set of source channels, has the AI summarize activity + notable shares/showcases, folds in the open-request "service board" (replacing the plain Phase-4 digest from the prior plan), and appends a summary of the official Minecraft changelog fetched from minecraft.net.

## Requirements
- Functional:
  1. Scheduled nightly run (21-22h Asia/Saigon), **posts directly, auto** (no mod approval).
  2. **Read live** the last 24h of messages from the configured source channels (no message persistence — read, summarize, discard).
  3. AI produces: what the community chatted about, notable shares/showcases, plus the **open service requests** (folds in the old digest content).
  4. **Fetch the official Minecraft changelog** from minecraft.net and summarize the latest update.
  5. Post as a forum thread/post in `1530077329102078042`. If it's a Forum channel, create a thread; if text, send an embed/message.
  6. **Idempotent:** one report per day (unique-constraint row, same pattern as digest), safe on restart/multi-process.
  7. Skip-when-empty: if there's no chat activity and nothing open/new, skip (no empty post).
- Non-functional: reading channels is rate-limit-aware (fetch in bounded batches, cap total messages, e.g. ≤200/channel); fetched chat is treated as untrusted data in the AI prompt; fail-soft on each sub-part (if changelog fetch fails, still post the rest).

## Architecture
- **Replaces `digestManager.ts`:** the prior plan's plain digest scheduler is superseded. Either repurpose `digestManager.ts` into `reportManager.ts` or add `reportManager.ts` and remove the digest scheduler wiring from `ready.ts`. **Decision: create `src/systems/reportManager.ts`, delete `digestManager.ts` and its `ready.ts`/`maintenance.ts` wiring** (the digest content lives inside the report now). Keep the `MaintenanceLog(kind, period)` idempotency idiom.
- **Source channels:** `config.report.sourceChannels = ['1281598090058665996','943893730123980881','1401215533243957388','1401215370978922506','1490685483892867163','1530093732500869231']` (chat, share, showcase, requestPaid, + two others per user). Read via `channel.messages.fetch({ limit: 100 })` in ≤2 pages, filter to last 24h, strip bot messages.
- **Report assembly:**
  1. Gather chat excerpts per channel (author + short content, capped).
  2. Query open requests (`RequestPost` OPEN/CLAIMED) + recent `ShowcasePost` PUBLISHED (same queries the digest used).
  3. Fetch Minecraft changelog (see below).
  4. Build ONE AI prompt: "summarize this community's day in Vietnamese: chat highlights, notable shares/showcases, list open service requests, and summarize the MC update." Pass chat/wiki/changelog as clearly-delimited untrusted context.
  5. Post the AI's text as a forum thread (title e.g. "Bản tin Stella — <date>").
- **Minecraft changelog fetch:** GET the official Mojang page (`https://www.minecraft.net/en-us/articles` or the patch-notes API `https://launchercontent.mojang.com/v2/javaPatchNotes.json` — prefer the JSON endpoint, far more stable than scraping HTML). Extract the latest entry title + body excerpt. Fail-soft: on error, omit the changelog section, still post the report.
- **Scheduler:** `setInterval` hourly check; fire when Saigon hour is within the 21-22h window AND no `MaintenanceLog(kind='report', period=<YYYY-MM-DD>)` row exists yet; claim the row (create-or-skip on unique) BEFORE posting so multi-instance can't double-post.
- **Manual trigger:** replace the `/maintenance digest` subcommand with `/maintenance report` (force-run for testing; still records the period row).

## Related Code Files
- Create: `src/systems/reportManager.ts`.
- Delete: `src/systems/digestManager.ts`.
- Modify: `src/events/ready.ts` (swap `startDigestScheduler` → `startReportScheduler`), `src/commands/maintenance.ts` (rename `digest` subcommand → `report`, call `runReport`), `src/config.ts` (`report.forumChannel='1530077329102078042'`, `report.sourceChannels`, `report.hourStart/hourEnd`, remove/repoint `digest` config).
- Reference: `digestManager.ts` (idempotency + tz idiom to carry over), `requestManager.ts`/`showcaseManager.ts` (query shapes), `aiClient` (Phase 2).

## Implementation Steps
1. `config.report` block (forum channel, source channels, hour window). Remove `digest` config or repoint.
2. `reportManager.ts`: gather chat (bounded fetch) + open requests + showcases + MC changelog (JSON endpoint, fail-soft).
3. One AI call to compose the Vietnamese report; cap `max_tokens`.
4. Post to forum channel (thread if Forum, message if text); claim `MaintenanceLog(kind='report', period=date)` before posting.
5. `ready.ts`: replace digest scheduler with report scheduler (hourly check, 21-22h window).
6. `maintenance.ts`: `digest` subcommand → `report` (force run).
7. Delete `digestManager.ts`; remove its imports. `npm run build`.

## Success Criteria
- [ ] At 21-22h Saigon, one AI report posts to `1530077329102078042` with chat highlights + notable shares/showcases + open service requests + MC update summary.
- [ ] Reading covers only the configured source channels, last 24h, bot messages excluded.
- [ ] Changelog fetch failure does NOT block the report (section omitted, rest posts).
- [ ] Exactly one report per day; restart/second instance within the day does not double-post.
- [ ] No post on a dead day (no activity, nothing open).
- [ ] `digestManager.ts` removed; `/maintenance report` triggers a manual run; `npm run build` clean.

## Risk Assessment
- **Token cost of summarizing a day of chat (HIGH):** cap messages/channel (≤200), cap `max_tokens`, one AI call per day (not per channel). Runs once nightly so cost is bounded and predictable.
- **Privacy — reading community chat (MED):** only the admin-configured channels; content is summarized then discarded (not stored); state this in the report footer so members know. Do not quote DMs or private channels.
- **minecraft.net scraping fragility (MED → mitigated):** prefer the stable `javaPatchNotes.json` endpoint over HTML scraping; fail-soft either way. User confirmed "use the Mojang page" — the JSON endpoint IS Mojang-official and far more durable.
- **Discord read rate limits (MED):** bounded `messages.fetch` (≤2 pages/channel), sequential across channels; the nightly cadence makes this a non-issue.
- **Prompt injection from chat/changelog (MED):** treat all fetched text as untrusted, delimited context; report generation only returns text, performs no actions.
- **Double-post on multi-instance (LOW):** unique `MaintenanceLog(kind='report', period)` claim before posting, same guard as digest.
