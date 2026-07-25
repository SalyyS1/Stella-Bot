import { config } from '../config';

// AI image client (OpenAI-compatible /v1/images/generations). Provider-agnostic:
// any gateway exposing the OpenAI images shape works — key + base URL + model come
// from env. Fail-closed: returns null on any failure so the caller degrades
// gracefully. Key comes from env (IMAGE_API_KEY), sent via the Authorization
// header (never a query string or a log), and is redacted from any diagnostic string.

export interface GeneratedImage {
    data: Buffer;       // decoded image bytes, ready to attach to a Discord message
    mimeType: string;   // e.g. image/png, image/jpeg
}

function getKey(): string | null {
    return process.env.IMAGE_API_KEY || null;
}

export function isImageEnabled(): boolean {
    return !!getKey() && !!config.ai.image.baseUrl && !!config.ai.image.model;
}

// Strip the API key (and common token shapes) from any string before logging.
function redact(input: unknown): string {
    let s = typeof input === 'string' ? input : (input instanceof Error ? input.message : JSON.stringify(input ?? ''));
    const key = getKey();
    if (key) s = s.split(key).join('[REDACTED_KEY]');
    s = s.replace(/(Bearer|api[_-]?key|access_token)\s*[:=]?\s*[A-Za-z0-9._-]+/gi, '$1 [REDACTED]');
    return s.slice(0, 800);
}

// Normalize the base URL to the images-generations endpoint. Accepts a base like
// https://host/v1 (append /images/generations) or a full endpoint.
function imagesEndpoint(): string {
    const base = config.ai.image.baseUrl.replace(/\/+$/, '');
    if (base.endsWith('/images/generations')) return base;
    if (base.endsWith('/v1')) return `${base}/images/generations`;
    return `${base}/v1/images/generations`;
}

// Sniff the image mime type from the decoded bytes' magic number. The images API
// returns raw base64 with no mime field, so infer it (PNG/JPEG/GIF/WebP) for the
// Discord attachment; default to png.
function sniffMime(buf: Buffer): string {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
    if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
    if (buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
    return 'image/png';
}

// Pull the first image out of an images-generations response. Handles the OpenAI
// shape: data[0].b64_json (base64 bytes). Falls back to data[0].url if a gateway
// returns a URL instead of inline bytes (fetched separately).
async function extractImage(json: any): Promise<GeneratedImage | null> {
    const first = json?.data?.[0];
    if (!first) return null;
    if (typeof first.b64_json === 'string' && first.b64_json.length) {
        const data = Buffer.from(first.b64_json, 'base64');
        return { data, mimeType: sniffMime(data) };
    }
    // Some gateways ignore response_format and return a hosted URL instead of
    // inline base64. Fetch it so the caller still gets bytes to attach.
    if (typeof first.url === 'string' && first.url.length) {
        try {
            const imgRes = await fetch(first.url);
            if (!imgRes.ok) return null;
            const data = Buffer.from(await imgRes.arrayBuffer());
            if (!data.length) return null;
            return { data, mimeType: sniffMime(data) };
        } catch {
            return null;
        }
    }
    return null;
}

// Generate an image from a text prompt. Returns null on any failure (disabled,
// timeout, HTTP error, safety block, or no image in the response).
export async function generateImage(prompt: string): Promise<GeneratedImage | null> {
    if (!isImageEnabled()) {
        console.error('[imageGen] disabled: IMAGE_API_KEY / base URL / model not set.');
        return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.ai.image.timeoutMs);
    try {
        const res = await fetch(imagesEndpoint(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${getKey()}`
            },
            body: JSON.stringify({
                model: config.ai.image.model,
                prompt: prompt.slice(0, config.ai.image.maxPromptLen),
                n: 1,
                // Ask for inline base64 so we get bytes directly. Gateways that
                // ignore this fall through to the data[0].url path in extractImage.
                response_format: 'b64_json'
            }),
            signal: controller.signal
        });

        const json: any = await res.json().catch(() => ({}));
        if (!res.ok) {
            console.error(`[imageGen] HTTP ${res.status}: ${redact(json?.error?.message || JSON.stringify(json))}`);
            return null;
        }
        const image = await extractImage(json);
        if (!image) {
            console.error(`[imageGen] empty/blocked response: ${redact(JSON.stringify(json).slice(0, 200))}`);
            return null;
        }
        return image;
    } catch (error) {
        console.error(`[imageGen] request failed: ${redact(error)}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}
