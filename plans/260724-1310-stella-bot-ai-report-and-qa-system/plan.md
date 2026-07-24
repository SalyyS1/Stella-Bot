---
title: "Stella Bot: AI Report and Q&A system"
description: "Add an AI layer to Stella: a daily AI-written community report (replacing the plain digest), a reply-driven Q&A assistant with a plugin-wiki knowledge store, and an admin /add-wiki command. AI is called via an OpenAI-compatible client against agentgw.cloud."
status: pending
priority: P2
branch: "main"
tags: [ai, report, qa, wiki, discord]
blockedBy: []
blocks: []
created: "2026-07-24"
createdBy: "ak:plan"
source: skill
---

# Stella Bot: AI Report and Q&A system

## Overview

Add an AI layer on top of the now-stable Stella bot (running on Supabase). Three capabilities on one shared AI client:

1. **AI client infra** — one OpenAI-compatible client (agentgw.cloud), key in `.env` (`AI_API_KEY`), model+endpoint in config. Never logged/committed.
2. **Wiki knowledge store** — a `WikiLink` table seeded with popular plugin docs (MythicMobs, MMOItems, MMOCore, ModelEngine, DeluxeMenus, PlaceholderAPI, Vault, LuckPerms...). Admin (role higher than bot) adds more via `/add-wiki`.
3. **Q&A assistant** — in a dedicated channel (`1530093732500869231`), a user **replies to a bot message that pinged them** to continue; also `/ask` slash anywhere. AI may fetch a wiki link when the question matches. Light per-user cooldown + concurrency cap.
4. **Daily AI report** — 21:00-22:00 VN, reads 24h of chat from a fixed channel list (live fetch, not stored), summarizes activity + notable share/showcase, fetches official Mojang changelog, posts to the forum channel `1530077329102078042`. **Replaces the plain digest** (Phase 4 of the prior plan).

### User decisions locked (from interview)
- **AI API format:** OpenAI-compatible (`/v1/chat/completions`). Endpoint+model in config, key in `.env`.
- **Q&A trigger:** dedicated channel `1530093732500869231`. Reply-to-bot activates (no `!s` required); `/ask` also works anywhere. A user may only reply to a bot message that pinged **them** — replying to a bot answer aimed at someone else is ignored (per-user conversation lanes, no cross-talk).
- **Q&A access:** everyone, with a **light cooldown** (~20s/user) + **per-user single in-flight** lock + a global concurrency cap (~2-3) so simultaneous askers don't overload.
- **Q&A + `/ask`:** both supported.
- **Wiki fetch:** AI fetches the matching wiki link on demand when a question references a known plugin.
- **Wiki seed:** seed popular plugins; `/add-wiki` (admin = role higher than bot) adds more.
- **Report channels (read, 24h live):** `1281598090058665996`, `943893730123980881`, `1401215533243957388`, `1401215370978922506`, `1490685483892867163`, `1530093732500869231`. Live fetch only — messages NOT persisted to DB.
- **Report schedule:** nightly 21:00-22:00 Asia/Saigon, auto-post (no mod approval), to forum `1530077329102078042`.
- **Changelog source:** official Mojang (`minecraft.net`), best-effort (skip section on fetch failure).
- **Digest:** the prior plan's standalone digest is REPLACED by this AI report (remove its scheduler).

## Phases

| # | Phase | Status | Priority | Depends |
|---|-------|--------|----------|---------|
| 1 | [Prerequisites & decisions](./phase-01-start.md) | Pending | P2 | — |
| 2 | [AI client infrastructure and config](./phase-02-ai-client-infrastructure-and-config.md) | Pending | P1 | — |
| 3 | [Wiki knowledge store and add-wiki command](./phase-03-wiki-knowledge-store-and-add-wiki-command.md) | Pending | P2 | 2 |
| 4 | [Q&A via reply and ask command](./phase-04-qa-via-reply-and-ask-command.md) | Pending | P1 | 2,3 |
| 5 | [Daily AI report replacing digest](./phase-05-daily-ai-report-replacing-digest.md) | Pending | P2 | 2 |

## Dependencies

- **Phase 2** (AI client) is the foundation — everything else calls it.
- **Phase 3** (wiki store) before Phase 4 so Q&A can fetch wiki links.
- **Phase 4** depends on 2+3.
- **Phase 5** depends only on 2; independent of Q&A. It removes the old digest scheduler (`digestManager` from the prior plan).

## Success Criteria (plan-level)

- [ ] AI client calls agentgw via OpenAI-compatible format; key only in `.env`, never logged.
- [ ] `/add-wiki` (admin-only) persists a wiki link; seed set present on first run.
- [ ] In the Q&A channel, replying to a bot message that pinged you continues the thread; replying to someone else's bot answer is ignored.
- [ ] `/ask` works anywhere; cooldown + per-user single-in-flight + global cap enforced (spam can't fan out unbounded AI calls).
- [ ] Nightly report posts to the forum with chat summary + notable posts + Mojang changelog (changelog gracefully skipped on fetch failure).
- [ ] Old standalone digest scheduler removed; no double-posting.
- [ ] `npm run build` clean.

## Cost & safety notes
- Every AI call spends tokens/quota. Cooldown + single-in-flight + concurrency cap are the cost guards. Report is once/day (bounded).
- Reading community chat is privacy-sensitive: fetch live, summarize, **never store raw messages**; the report is aggregate, not verbatim quotes of private talk.
- API key is a secret: `.env` only, redact from any error log (reuse the redaction pattern from the Facebook manager).

## Open Questions
- agentgw exact base URL + model id — user will confirm/rotate key before go-live (currently a test key, to be replaced).
- Token budget per report (context size of 24h chat across 6 channels could be large) — Phase 5 must cap/truncate input.

<!-- slug: stella-bot-ai-report-and-qa-system -->
