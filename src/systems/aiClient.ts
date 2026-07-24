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
        const text = json?.choices?.[0]?.message?.content;
        if (typeof text !== 'string' || !text.trim()) {
            console.error('[aiClient] Empty/invalid completion response.');
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
