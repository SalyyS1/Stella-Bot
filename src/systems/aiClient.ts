import { config } from '../config';

// Shared OpenAI-compatible AI client (agentgw). Every AI feature (Q&A, daily
// report) calls askAI. Fail-closed: returns null on any failure so callers
// degrade gracefully instead of crashing. Key comes from env, is sent via the
// Authorization header (never a query string), and is redacted from any log.

// Multimodal content parts, in the OpenAI-compatible shape every gateway that
// supports vision accepts. Kept as a union with plain string so every existing
// caller (the vast majority, all text) is untouched.
export interface AiTextPart {
    type: 'text';
    text: string;
}

export interface AiImagePart {
    type: 'image_url';
    image_url: { url: string };
}

export type AiContentPart = AiTextPart | AiImagePart;

export interface AiMessage {
    role: 'system' | 'user' | 'assistant';
    content: string | AiContentPart[];
}

// Whether a payload carries images. Used to decide if a failure is worth retrying
// without them — see askAI.
function hasImageParts(messages: AiMessage[]): boolean {
    return messages.some(m =>
        Array.isArray(m.content) && m.content.some(p => p.type === 'image_url')
    );
}

// Collapse image parts away, keeping the text. This is the fallback path: whether
// a given gateway/model accepts vision cannot be known from here, so instead of
// requiring a capability probe up front, an image request that gets rejected is
// retried as text. A gateway without vision degrades to the old behaviour rather
// than losing the report for that window.
//
// imageInstruction is removed from the system turn at the same time, and that part
// is not cosmetic. Dropping the pictures while still telling the model "look at
// the attached images and describe them" leaves it obeying an instruction about
// something that is no longer in the payload — so it answers exactly that, and the
// summary comes back saying it cannot see any image. The pictures being absent is
// the intended degradation; a summary that talks ABOUT their absence is a bug.
function stripImageParts(messages: AiMessage[], imageInstruction?: string): AiMessage[] {
    return messages.map(m => {
        const content = Array.isArray(m.content)
            ? m.content
                .filter((p): p is AiTextPart => p.type === 'text')
                .map(p => p.text)
                .join('\n')
            : m.content;
        if (!imageInstruction) return { role: m.role, content };
        // Also covers a caller that glued the instruction on with a space, which is
        // how the chunk summarizer builds its system turn.
        const cleaned = content.split(imageInstruction).join('').replace(/[ \t]{2,}/g, ' ').trim();
        return { role: m.role, content: cleaned };
    });
}

interface AskOpts {
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    // The exact sentence(s) that tell the model to look at images. Passed in rather
    // than known here because aiClient is shared by every AI feature and must not
    // carry any one feature's prompt text. Only used on the text-only retry.
    imageInstruction?: string;
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
// or a chain-of-thought / reasoning block (<thinking>…</thinking>) even when no
// tools are offered and no reasoning was requested. We want neither in Discord, so
// strip both before the text reaches the user — otherwise they see junk XML or the
// model's internal monologue instead of the actual answer.
function stripToolCalls(text: string): string {
    return text
        // Reasoning / chain-of-thought blocks (various tag spellings gateways use).
        .replace(/<(?:antml:)?think(?:ing)?[\s\S]*?<\/(?:antml:)?think(?:ing)?>/gi, '')
        .replace(/<(?:antml:)?reasoning[\s\S]*?<\/(?:antml:)?reasoning>/gi, '')
        // Tool-call XML.
        .replace(/<(?:antml:)?invoke[\s\S]*?<\/(?:antml:)?invoke>/gi, '')
        .replace(/<(?:antml:)?function_calls[\s\S]*?<\/(?:antml:)?function_calls>/gi, '')
        .replace(/<(?:antml:)?parameter[\s\S]*?<\/(?:antml:)?parameter>/gi, '')
        // Drop any stray unclosed opener (thinking/tool-call) at the tail.
        .replace(/<(?:antml:)?(?:think(?:ing)?|reasoning|invoke|function_calls|parameter)\b[\s\S]*$/gi, '')
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

// Outcome of one HTTP attempt. `rejected` distinguishes "the gateway refused this
// payload" (a 4xx — worth retrying without images) from a transport/5xx failure,
// where dropping the images would not help and would silently degrade the answer.
interface Attempt {
    text: string | null;
    rejected: boolean;
}

async function attempt(messages: AiMessage[], opts: AskOpts): Promise<Attempt> {
    const controller = new AbortController();
    // Giữ hai con số này ra biến để nhánh catch nói được HẾT GIỜ BAO LÂU và với
    // ngân sách token nào. Không có chúng thì log chỉ có "aborted" — đúng nhưng vô
    // dụng, vì mỗi tính năng đặt một hạn giờ khác nhau.
    const budgetMs = opts.timeoutMs ?? config.ai.timeoutMs;
    const tokenBudget = opts.maxTokens ?? config.ai.maxTokens;
    const timeout = setTimeout(() => controller.abort(), budgetMs);
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
                temperature: opts.temperature ?? config.ai.temperature,
                // Explicitly non-streaming: some gateways default to SSE, which
                // would arrive as `data: {...}` lines that JSON.parse can't read.
                stream: false
            }),
            signal: controller.signal
        });

        // Read the raw body ONCE as text, then parse. This way a non-JSON body
        // (SSE stream, HTML error page, empty body) can be logged verbatim
        // (redacted, truncated) instead of being silently swallowed into `{}` —
        // which is what hid the real gateway response behind "Shape: keys=[]".
        const raw = await res.text().catch(() => '');
        let json: any = null;
        try {
            json = raw ? JSON.parse(raw) : null;
        } catch {
            json = null;
        }
        if (!res.ok) {
            console.error(`[aiClient] HTTP ${res.status}: ${redactAi(json?.error?.message || raw)}`);
            // A 4xx means the gateway understood the request and refused it — an
            // unsupported image part lands here. 5xx/transport errors are not
            // attributable to the payload, so they are not retried differently.
            return { text: null, rejected: res.status >= 400 && res.status < 500 };
        }
        if (!json) {
            // 200 OK but body isn't JSON — log the raw head so the actual gateway
            // format (SSE? plain text? error HTML?) is visible next time.
            console.error(`[aiClient] Non-JSON 200 body: ${redactAi(raw.slice(0, 300))}`);
            return { text: null, rejected: false };
        }
        const text = stripToolCalls(extractCompletionText(json) || '');
        if (!text || !text.trim()) {
            // Log the response SHAPE (keys only, redacted) so an unexpected gateway
            // format can be diagnosed without dumping secrets or full payloads.
            console.error(`[aiClient] Empty/invalid completion. Shape: ${redactAi(describeShape(json))}`);
            // An empty 200 is also how some gateways answer a payload they parsed
            // but could not handle, so treat it as payload-attributable too.
            return { text: null, rejected: true };
        }
        return { text: text.trim(), rejected: false };
    } catch (error) {
        // Phân biệt HẾT GIỜ với lỗi mạng. Cả hai đều tới đây, nhưng abort do timeout
        // hiện lên đúng một dòng "This operation was aborted" — không nói là hết giờ,
        // không nói giờ đó là bao lâu, và không nói ai đặt nó. Người đọc log không có
        // cách nào biết cần tăng cái gì. Đây là lỗi Saly gặp khi chạy /plugin.
        const aborted = error instanceof Error
            && (error.name === 'AbortError' || /abort/i.test(error.message));
        if (aborted) {
            console.error(
                `[aiClient] HẾT GIỜ sau ${Math.round(budgetMs / 1000)}s ` +
                `(max_tokens=${tokenBudget}). Model chưa trả xong trong hạn đó — ` +
                'tăng timeoutMs của tính năng đang gọi, hoặc giảm max_tokens.'
            );
        } else {
            console.error(`[aiClient] request failed: ${redactAi(error)}`);
        }
        return { text: null, rejected: false };
    } finally {
        clearTimeout(timeout);
    }
}

export async function askAI(messages: AiMessage[], opts: AskOpts = {}): Promise<string | null> {
    if (!isAiEnabled()) {
        console.error('[aiClient] AI disabled: AI_API_KEY / base URL / model not set.');
        return null;
    }

    const first = await attempt(messages, opts);
    if (first.text) return first.text;

    // Vision is optional and unverified on this gateway. Rather than gate the
    // feature behind a capability probe that needs a live key, an image payload
    // the gateway refuses is retried as text — so a model without vision still
    // produces the report, just without the pictures.
    if (first.rejected && hasImageParts(messages)) {
        console.error(
            '[aiClient] gateway từ chối payload có ảnh — thử lại bằng TEXT (bỏ cả câu dặn xem ảnh). ' +
            'Bản tóm tắt sẽ không có phần ảnh, nhưng cũng KHÔNG được nói là "không thấy ảnh".'
        );
        const retry = await attempt(stripImageParts(messages, opts.imageInstruction), opts);
        return retry.text;
    }

    return null;
}
