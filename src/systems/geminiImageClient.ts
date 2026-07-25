import { config } from '../config';

// Gemini image client ("Nano Banana"). Separate provider from the text AI
// (agentgw): text = agentgw, image = Google Generative Language API. Fail-closed:
// returns null on any failure so the caller degrades gracefully. Key comes from
// env (GEMINI_API_KEY), sent via the x-goog-api-key header (never a query string
// or a log), and is redacted from any diagnostic string.

export interface GeneratedImage {
    data: Buffer;       // decoded image bytes, ready to attach to a Discord message
    mimeType: string;   // e.g. image/png
}

function getKey(): string | null {
    return process.env.GEMINI_API_KEY || null;
}

export function isImageEnabled(): boolean {
    return !!getKey() && !!config.ai.image.baseUrl && !!config.ai.image.model;
}

// Strip the API key (and common token shapes) from any string before logging.
function redact(input: unknown): string {
    let s = typeof input === 'string' ? input : (input instanceof Error ? input.message : JSON.stringify(input ?? ''));
    const key = getKey();
    if (key) s = s.split(key).join('[REDACTED_KEY]');
    s = s.replace(/(x-goog-api-key|key|api[_-]?key)\s*[:=]?\s*[A-Za-z0-9._-]+/gi, '$1 [REDACTED]');
    return s.slice(0, 800);
}

// Build the generateContent endpoint for the configured model. Accepts a base
// like https://generativelanguage.googleapis.com (append the versioned path).
function generateEndpoint(): string {
    const base = config.ai.image.baseUrl.replace(/\/+$/, '');
    return `${base}/v1/models/${config.ai.image.model}:generateContent`;
}

// Find the first inline image part in a generateContent response. Parts can be
// text or image, so iterate and pick whichever carries inline image bytes.
// Handles both inlineData (camelCase, v1) and inline_data (snake_case) spellings.
function extractImagePart(json: any): GeneratedImage | null {
    const parts = json?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return null;
    for (const part of parts) {
        const inline = part?.inlineData || part?.inline_data;
        const b64 = inline?.data;
        if (typeof b64 === 'string' && b64.length) {
            return {
                data: Buffer.from(b64, 'base64'),
                mimeType: inline.mimeType || inline.mime_type || 'image/png'
            };
        }
    }
    return null;
}

// Generate an image from a text prompt. Returns null on any failure (disabled,
// timeout, HTTP error, safety block, or no image in the response).
export async function generateImage(prompt: string): Promise<GeneratedImage | null> {
    if (!isImageEnabled()) {
        console.error('[geminiImage] disabled: GEMINI_API_KEY / base URL / model not set.');
        return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.ai.image.timeoutMs);
    try {
        const res = await fetch(generateEndpoint(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': getKey() as string
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt.slice(0, config.ai.image.maxPromptLen) }] }],
                generationConfig: { responseModalities: ['IMAGE'] }
            }),
            signal: controller.signal
        });

        const json: any = await res.json().catch(() => ({}));
        if (!res.ok) {
            console.error(`[geminiImage] HTTP ${res.status}: ${redact(json?.error?.message || JSON.stringify(json))}`);
            return null;
        }
        // A safety block returns 200 with no image part but a promptFeedback reason.
        const image = extractImagePart(json);
        if (!image) {
            const reason = json?.promptFeedback?.blockReason || json?.candidates?.[0]?.finishReason || 'no image part';
            console.error(`[geminiImage] empty/blocked response: ${redact(reason)}`);
            return null;
        }
        return image;
    } catch (error) {
        console.error(`[geminiImage] request failed: ${redact(error)}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}
