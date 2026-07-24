---
phase: 2
title: "AI client infrastructure and config"
status: pending
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 2: AI client infrastructure and config

## Overview
Shared AI client every later phase uses. OpenAI-compatible chat-completions call to agentgw, fail-closed when key/config missing, redact key from any log. This is the foundation for Q&A (Phase 4) and the daily report (Phase 5).

## Requirements
- Functional: a single `askAI(messages, opts)` helper that POSTs to the agentgw chat-completions endpoint and returns the text, with timeout + error handling.
- Non-functional: key via `process.env.AI_API_KEY` sent in `Authorization: Bearer` header (never query string, never logged); base URL + model in `config.ai`; feature-disabled + logged-once when key missing (fail-closed, matching the Facebook manager pattern).

## Architecture
- **New module:** `src/systems/aiClient.ts` (<200 lines).
  - `isAiEnabled()`: true only when `AI_API_KEY` + base URL + model present.
  - `askAI(messages: {role, content}[], opts?: {maxTokens?, temperature?, timeoutMs?}): Promise<string | null>` — uses global `fetch` (Node 20+), `AbortController` timeout (default ~30s), returns `null` on failure (callers degrade gracefully).
  - `redactAi(err)`: strip the key from any error string before it can reach a Discord admin log (reuse the redaction idiom from `facebookCrossPostManager.ts`).
- **Config:** add `config.ai = { baseUrl: process.env.AI_BASE_URL, model: process.env.AI_MODEL, maxTokens, temperature }`.
- No DB. No Discord coupling — pure HTTP helper so both Q&A and report reuse it.

## Related Code Files
- Create: `src/systems/aiClient.ts`.
- Modify: `src/config.ts` (add `ai` block), `.env.example` (AI keys — done in Phase 1).
- Reference: `src/systems/facebookCrossPostManager.ts` (fail-closed + `redact()` + header-token pattern to mirror).

## Implementation Steps
1. Add `config.ai` block reading `AI_BASE_URL` / `AI_MODEL` (+ sane defaults for maxTokens/temperature).
2. Write `aiClient.ts`: `isAiEnabled`, `askAI` (fetch + AbortController timeout + Bearer header), `redactAi`.
3. On any non-2xx or network error: log once via `console.error(redactAi(...))`, return `null`. Never throw into callers.
4. Manual smoke: a tiny throwaway call to confirm endpoint shape/model before Phase 4/5 build on it (verify OpenAI-compat).
5. `npm run build`.

## Success Criteria
- [ ] `askAI` returns text on success, `null` on failure (never throws).
- [ ] Key sent via Authorization header; never in a URL or a log line (redaction verified).
- [ ] Feature fail-closed when `AI_API_KEY` unset (logged once, callers no-op).
- [ ] `npm run build` clean.

## Risk Assessment
- **Endpoint not OpenAI-compatible (MED):** verify shape with one manual call (step 4) before Phase 4/5 depend on it; adjust request/response parsing if agentgw differs.
- **Token cost blowout (MED):** cap `maxTokens`; Q&A cooldown (Phase 4) + single daily report (Phase 5) bound call volume.
- **Key leak via logs (HIGH → mitigated):** redaction helper + header-only token.
