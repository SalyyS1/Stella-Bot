// Temp probe: does the configured AI gateway accept (a) image input (vision)
// and (b) tool definitions? Both are prerequisites for the report-v2 design.
// ASCII-only output on purpose (Windows console is cp1252).
require('dotenv').config();

const KEY = process.env.AI_API_KEY;
const BASE = (process.env.AI_BASE_URL || 'https://agentgw.cloud').replace(/\/+$/, '');
const MODEL = process.env.AI_MODEL || 'agentgw-opus-4-8';

function endpoint() {
    if (BASE.endsWith('/chat/completions')) return BASE;
    if (BASE.endsWith('/v1')) return `${BASE}/chat/completions`;
    return `${BASE}/v1/chat/completions`;
}

function redact(s) {
    if (!s) return '';
    let out = String(s);
    if (KEY) out = out.split(KEY).join('[REDACTED]');
    return out.slice(0, 400).replace(/\s+/g, ' ');
}

// The gateway answers a rate-limited request with the PREVIOUS error, cached and
// tagged "(reset after Ns)". Back to back that made three different probes report
// one identical image error - including the tool probe, which sends no image at
// all. Spacing the calls is what makes each result its own.
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 1x1 solid red PNG.
const RED_PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

async function post(body, label) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
        const res = await fetch(endpoint(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        const raw = await res.text().catch(() => '');
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { /* non-JSON */ }
        const msg = json && json.choices && json.choices[0] && json.choices[0].message;
        let text = '';
        if (msg && typeof msg.content === 'string') text = msg.content;
        else if (msg && Array.isArray(msg.content)) text = msg.content.map(p => (p && p.text) || '').join('');
        const toolCalls = msg && msg.tool_calls ? JSON.stringify(msg.tool_calls).slice(0, 200) : '';
        console.log(`[${label}] HTTP ${res.status}`);
        console.log(`[${label}] text: ${redact(text) || '(empty)'}`);
        if (toolCalls) console.log(`[${label}] tool_calls: ${redact(toolCalls)}`);
        if (!res.ok) console.log(`[${label}] error body: ${redact((json && json.error && json.error.message) || raw)}`);
        return res.ok;
    } catch (e) {
        console.log(`[${label}] request failed: ${redact(e && e.message)}`);
        return false;
    } finally {
        clearTimeout(timer);
    }
}

(async () => {
    if (!KEY) { console.log('AI_API_KEY not set - cannot probe.'); process.exit(1); }
    console.log(`endpoint=${endpoint()} model=${MODEL}`);

    // A) Vision: image part in a user message.
    await post({
        model: MODEL,
        max_tokens: 30,
        stream: false,
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: 'Answer with ONE word only. What color fills this image? If you cannot see any image, answer NOIMAGE.' },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${RED_PNG}` } }
            ]
        }]
    }, 'VISION');

    await sleep(15000);

    // A2) Vision via an https URL, which is what the bot ACTUALLY sends: images
    // come from Discord's CDN as links, never inlined as data: URLs. A gateway can
    // reject one and accept the other, so a data: failure alone proves nothing
    // about the real path. Any stable public PNG answers the question.
    await post({
        model: MODEL,
        max_tokens: 30,
        stream: false,
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: 'Describe this image in at most 3 words. If you cannot see any image, answer NOIMAGE.' },
                // httpbin rather than Wikipedia: Wikimedia refused the gateway's
                // fetch outright (param "url", "Upstream status code: 400"), which
                // measured Wikimedia's bot policy instead of the gateway.
                { type: 'image_url', image_url: { url: 'https://httpbin.org/image/png' } }
            ]
        }]
    }, 'VISION_URL');

    await sleep(15000);

    // B) Tool-calling: offer one tool and see if the gateway accepts the field.
    await post({
        model: MODEL,
        max_tokens: 60,
        stream: false,
        tool_choice: 'auto',
        tools: [{
            type: 'function',
            function: {
                name: 'web_search',
                description: 'Search the web for current information',
                parameters: {
                    type: 'object',
                    properties: { query: { type: 'string', description: 'search query' } },
                    required: ['query']
                }
            }
        }],
        messages: [{ role: 'user', content: 'Use the web_search tool to look up the latest Minecraft Java version. Call the tool, do not answer from memory.' }]
    }, 'TOOLS');
})();
