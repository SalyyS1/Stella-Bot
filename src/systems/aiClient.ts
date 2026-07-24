import { config } from '../config';

// Shared OpenAI-compatible AI client (agentgw). Every AI feature (Q&A, daily
// report) calls askAI. Fail-closed: returns null on any failure so callers
// degrade gracefully instead of crashing. Key comes from env, is sent via the
// Authorization header (never a query string), and is redacted from any log.

export interface AiMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface AskOpts {
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
}

function getKey(): string | null {
    return process.env.AI_API_KEY || null;
}

export function isAiEnabled(): boolean {
    return !!getKey() && !!config.ai.baseUrl && !!config.ai.model;
}

// Strip the API key (and common token shapes) from any string before logging.
export function redactAi(input: unknown): string {
    let s = typeof input === 'string' ? input : (input instanceof Error ? input.message : JSON.stringify(input ?? ''));
    const key = getKey();
    if (key) s = s.split(key).join('[REDACTED_KEY]');
    s = s.replace(/(Bearer|api[_-]?key|access_token)\s*[:=]?\s*[A-Za-z0-9._-]+/gi, '$1 [REDACTED]');
    return s.slice(0, 800);
}

// Normalize the base URL to the chat-completions endpoint. Accepts a base like
// https://agentgw.cloud (append /v1/chat/completions) or a full endpoint.
function completionsEndpoint(): string {
    const base = config.ai.baseUrl.replace(/\/+$/, '');
    if (base.endsWith('/chat/completions')) return base;
    if (base.endsWith('/v1')) return `${base}/chat/completions`;
    return `${base}/v1/chat/completions`;
}

// Pull the answer text out of a completion response. Handles the OpenAI shape
// plus a few gateway variants (content as an array of parts, Anthropic-style
// content blocks, or a flat text field) so a non-standard gateway still works.
function extractCompletionText(json: any): string | null {
    if (!json || typeof json !== 'object') return null;
    const choice = json.choices?.[0];
    const msg = choice?.message;
    // OpenAI standard: choices[0].message.content is a string.
    if (typeof msg?.content === 'string') return msg.content;
    // Some gateways return content as an array of parts [{type,text}] or [{text}].
    if (Array.isArray(msg?.content)) {
        const joined = msg.content.map((p: any) => (typeof p === 'string' ? p : p?.text || '')).join('');
        if (joined.trim()) return joined;
    }
    // Legacy completions: choices[0].text
    if (typeof choice?.text === 'string') return choice.text;
    // Anthropic-style top-level content blocks.
    if (Array.isArray(json.content)) {
        const joined = json.content.map((p: any) => (typeof p === 'string' ? p : p?.text || '')).join('');
        if (joined.trim()) return joined;
    }
    // Flat fallbacks.
    if (typeof json.output_text === 'string') return json.output_text;
    if (typeof json.text === 'string') return json.text;
    return null;
}

// Some gateway models emit raw tool-call XML (e.g. <invoke name="web_search">...)
// even when no tools are offered. We provide no tools, so strip any such block
// before the text reaches Discord — otherwise users see junk XML instead of an answer.
function stripToolCalls(text: string): string {
    return text
        .replace(/<(?:antml:)?invoke[\s\S]*?<\/(?:antml:)?invoke>/gi, '')
        .replace(/<(?:antml:)?function_calls[\s\S]*?<\/(?:antml:)?function_calls>/gi, '')
        .replace(/<(?:antml:)?parameter[\s\S]*?<\/(?:antml:)?parameter>/gi, '')
        // Drop any stray unclosed tool-call opener at the tail.
        .replace(/<(?:antml:)?(?:invoke|function_calls|parameter)\b[\s\S]*$/gi, '')
        .trim();
}

// Describe the top-level shape of a response (keys + choice keys) for diagnostics
// without dumping the full body.
function describeShape(json: any): string {
    if (!json || typeof json !== 'object') return typeof json;
    const keys = Object.keys(json).join(',');
    const choiceKeys = json.choices?.[0] ? Object.keys(json.choices[0]).join(',') : 'none';
    const msgType = typeof json.choices?.[0]?.message?.content;
    return `keys=[${keys}] choice0=[${choiceKeys}] message.content=${msgType}`;
}

export async function askAI(messages: AiMessage[], opts: AskOpts = {}): Promise<string | null> {
    if (!isAiEnabled()) {
        console.error('[aiClient] AI disabled: AI_API_KEY / base URL / model not set.');
        return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? config.ai.timeoutMs);
    try {
        const res = await fetch(completionsEndpoint(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${getKey()}`
            },
            body: JSON.stringify({
                model: config.ai.model,
                messages,
                max_tokens: opts.maxTokens ?? config.ai.maxTokens,
                temperature: opts.temperature ?? config.ai.temperature
            }),
            signal: controller.signal
        });

        const json: any = await res.json().catch(() => ({}));
        if (!res.ok) {
            console.error(`[aiClient] HTTP ${res.status}: ${redactAi(json?.error?.message || JSON.stringify(json))}`);
            return null;
        }
        const text = stripToolCalls(extractCompletionText(json) || '');
        if (!text || !text.trim()) {
            // Log the response SHAPE (keys only, redacted) so an unexpected gateway
            // format can be diagnosed without dumping secrets or full payloads.
            console.error(`[aiClient] Empty/invalid completion. Shape: ${redactAi(describeShape(json))}`);
            return null;
        }
        return text.trim();
    } catch (error) {
        console.error(`[aiClient] request failed: ${redactAi(error)}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}
