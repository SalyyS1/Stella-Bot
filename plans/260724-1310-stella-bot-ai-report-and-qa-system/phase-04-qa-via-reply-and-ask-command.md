---
phase: 4
title: "Q&A via reply and ask command"
status: pending
priority: P1
effort: "2-3d"
dependencies: [2, 3]
---

# Phase 4: Q&A via reply and ask command

## Overview
Community-facing AI Q&A. Two entry points: a dedicated Q&A channel where **replying to the bot** continues a thread, and a `/ask` slash command usable anywhere. The AI can consult the Phase-3 wiki catalog and fetch a matching wiki page when the question is about a plugin.

## Requirements
- Functional:
  1. **Q&A channel `1530093732500869231`:** a user message that is a **reply to one of the bot's own messages** triggers an AI answer. Also support prefix `!s <question>` (user-stated) as a second trigger.
  2. **Thread ownership:** a reply only triggers if the bot message being replied to was itself a reply to (pinged) THAT same user. A user replying to the bot's answer meant for someone else is ignored (keeps conversations separated).
  3. **`/ask <question>`** slash command works in any channel (ephemeral or public reply).
  4. **Per-user serialization:** each user has at most ONE in-flight AI request (a second reply while one is processing is rejected with a short notice). Different users run concurrently, capped at a global concurrency limit (~2-3).
  5. **Cooldown:** light per-user cooldown (~15-20s) on top, to blunt spam.
  6. **Wiki-aware:** if the question mentions a known plugin (Phase-3 catalog match), fetch that wiki page and include an excerpt as context for the AI.
- Non-functional: bot always pings the asker in its answer (so the reply-ownership check works on the next turn); answers truncated to Discord's 2000-char limit (or split); AI/token errors fail gracefully with a friendly message.

## Architecture
- **New module:** `src/systems/aiQaManager.ts` (<200 lines): owns the per-user in-flight `Set<userId>`, the global concurrency counter, cooldown map, and the `answerQuestion(question, opts)` routine that assembles context → calls `aiChat` (Phase 2) → returns text.
- **Trigger 1 (reply) — in `messageCreate.ts`:** after existing guards, if `message.channelId === config.ai.qaChannel` AND `message.reference?.messageId` points to a bot message:
  - Fetch the referenced message; confirm `refMsg.author.id === bot.id` AND `refMsg.mentions.has(message.author.id)` (bot's message pinged this same user) OR the referenced message is the channel's seed/intro. Else ignore silently.
  - Also handle `!s <q>` prefix in the same channel (no reply needed for a fresh question).
- **Trigger 2 (`/ask`) — new `src/commands/ask.ts`:** `defer` → `answerQuestion` → `editReply`. Public channel; answer pings the caller.
- **Reply-ownership rule (the "chia luồng" request):**
  - Fresh question: `!s ...` or `/ask ...` → bot answers, **pinging the asker**. That answer becomes the head of that user's thread.
  - Continue: user replies to a bot message that pinged them → allowed. Replying to a bot message that pinged someone else → ignored. This is enforced by the `refMsg.mentions.has(author.id)` check.
- **Concurrency/cooldown (the "nổ đầu" request):**
  - `inFlight: Set<string>` — reject a user's new question if their id is present ("bạn đang có 1 câu hỏi đang xử lý").
  - `activeCount` with `MAX_CONCURRENT=3` — if exceeded, queue-lite: reply "Stella đang bận, thử lại sau vài giây."
  - `cooldown: Map<string, number>` — 15-20s per user.
- **Wiki context:** `findWikiEntry(question tokens)` (Phase 3). On match, fetch the URL (see SSRF note), extract a text excerpt (strip HTML, cap ~2-4k chars), prepend as system/context. On no match or fetch fail, answer from model knowledge only.
- **System prompt:** short, Vietnamese-first, "you are Stella, a Minecraft server/plugin assistant; be concise; if unsure, say so."

## Related Code Files
- Create: `src/systems/aiQaManager.ts`, `src/commands/ask.ts`.
- Modify: `src/events/messageCreate.ts` (reply + `!s` trigger in the Q&A channel — add near the top, before generic channel handlers), `src/config.ts` (`ai.qaChannel`, cooldown/concurrency constants).
- Reference: `messageCreate.ts` (existing early-return guard structure, `handleMusicPrefix` prefix pattern), `aiClient` (Phase 2), `wikiManager` (Phase 3).

## Implementation Steps
1. `config.ai`: `qaChannel = '1530093732500869231'`, `qaCooldownMs`, `qaMaxConcurrent`.
2. `aiQaManager.ts`: in-flight set + concurrency + cooldown + `answerQuestion` (assemble wiki context, call `aiChat`, format ≤2000 chars).
3. `messageCreate.ts`: Q&A-channel handler — reply-ownership check + `!s` prefix; ignore non-owner replies silently.
4. `ask.ts`: `/ask` command (defer, answer, ping caller).
5. Wiki fetch + HTML→text excerpt helper (shared with Phase 5's fetch or in aiQaManager).
6. `npm run build`.

## Success Criteria
- [ ] In the Q&A channel, replying to a bot message that pinged you continues the thread; replying to one that pinged someone else is ignored.
- [ ] `!s <q>` and `/ask <q>` both return an AI answer that pings the asker.
- [ ] A second question from the same user while one is processing is rejected with a notice; different users still work.
- [ ] Cooldown blocks rapid repeat questions from one user.
- [ ] A plugin question fetches the matching wiki page as context (verify with one seeded plugin).
- [ ] `npm run build` clean.

## Risk Assessment
- **Token/quota burn (HIGH — main cost surface):** cooldown + per-user in-flight + global concurrency cap are the controls. Cap `max_tokens` per answer in the AI call (Phase 2). Consider a per-day per-user soft cap if abuse appears (defer unless needed — YAGNI).
- **SSRF via wiki fetch (MED):** only fetch URLs from the admin-curated `WikiEntry` catalog, never arbitrary user-supplied URLs; enforce http(s); set a fetch timeout + size cap; do not follow redirects to internal hosts. (Reuse the fail-closed mindset from the prior plan's SSRF decision.)
- **Prompt injection via chat/wiki content (MED):** wiki page or user text may contain "ignore previous instructions." Treat fetched content as untrusted data in the prompt (clearly delimited), keep the system prompt authoritative, and never let Q&A perform actions — it only returns text.
- **Reply-ownership false negatives (LOW):** if the bot forgets to ping the asker, the next reply won't match; mitigation — always ping the asker in every answer.
- **2000-char overflow (LOW):** truncate or split answers.
