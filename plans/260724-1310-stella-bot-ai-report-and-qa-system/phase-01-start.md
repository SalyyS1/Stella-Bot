---
phase: 1
title: "Prerequisites & decisions"
status: pending
priority: P2
effort: "0.5h + external key setup"
dependencies: []
---

# Phase 1: Prerequisites & decisions

## Overview
Non-code phase. Lock the AI provider details and env keys the later phases consume. The agentgw key is currently a shared/test value the user will rotate before go-live.

## Requirements
- Functional: confirm agentgw base URL, model id, and OpenAI-compatible endpoint shape. Add `.env.example` placeholders.
- Non-functional: real key lives only in `.env` (host + local), never committed, never logged.

## Architecture
No code beyond `.env.example` placeholders. Produces the config values Phase 2 wires.

## Related Code Files
- Modify: `.env.example` — add `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` placeholders (no real values).

## Implementation Steps
1. Confirm base URL (likely `https://agentgw.cloud` + an OpenAI-compatible path such as `/v1/chat/completions` — verify at cook time) and model id (`agentgw-opus-4-8` per user).
2. Add placeholder env keys to `.env.example`.
3. Note: user rotates the leaked test key before production use (key was pasted in chat; treat as compromised).

## Success Criteria
- [ ] `.env.example` has AI placeholders; no secrets committed.
- [ ] Base URL + model id confirmed for Phase 2.
- [ ] Key-rotation reminder recorded.

## Risk Assessment
- **Wrong endpoint shape (MED):** if agentgw is NOT OpenAI-compatible, Phase 2's client needs adjusting — verify with one manual test call before building on it.
- **Leaked key (HIGH until rotated):** current key exposed in chat; rotate before go-live.
