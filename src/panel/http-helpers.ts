import { IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../config';

// Tiện ích HTTP cho panel. Không dùng express: panel chỉ đọc, vài chục route, và mỗi
// dependency thêm vào là thêm RAM trên cái host đã từng OOM vì tsc.

const SECURITY_HEADERS: Record<string, string> = {
    // Panel không được nhúng trong iframe của trang khác (chống clickjacking lên một
    // giao diện quản trị).
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    // Không gửi URL panel sang trang ngoài khi admin bấm link trong dữ liệu người dùng.
    'Referrer-Policy': 'no-referrer',
    // Panel tự chứa toàn bộ tài nguyên. 'unsafe-inline' cho style là nhượng bộ cho
    // Tailwind/Next; script thì KHÔNG được nới, đó là cửa chính của XSS.
    'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https://cdn.discordapp.com https://media.discordapp.net; " +
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};

export function applySecurityHeaders(res: ServerResponse): void {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    applySecurityHeaders(res);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        'Cache-Control': 'no-store'
    });
    res.end(payload);
}

export function sendText(res: ServerResponse, status: number, text: string): void {
    applySecurityHeaders(res);
    res.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(text),
        'Cache-Control': 'no-store'
    });
    res.end(text);
}

// Trần số cookie: một header Cookie dài vài nghìn cặp là một cách làm CPU của bot
// bận mà không cần gửi nhiều byte.
const MAX_COOKIES = 30;

export function readCookies(req: IncomingMessage): Record<string, string> {
    const header = req.headers.cookie;
    if (!header) return {};
    const out: Record<string, string> = {};
    const parts = header.split(';', MAX_COOKIES);
    for (const part of parts) {
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        const name = part.slice(0, eq).trim();
        if (!name) continue;
        const raw = part.slice(eq + 1).trim();
        try {
            out[name] = decodeURIComponent(raw);
        } catch {
            // Cookie hỏng thì bỏ qua cookie đó, không làm cả request thất bại.
            out[name] = raw;
        }
    }
    return out;
}

/**
 * IP của client, dùng cho giới hạn theo IP ở phase sau.
 *
 * Khi có proxy: lấy `cf-connecting-ip` trước, không thì lấy phần tử CUỐI của
 * `x-forwarded-for`. Lấy phần tử đầu là sai — client tự gửi được header này và proxy
 * chỉ *nối thêm* vào cuối, nên phần tử đầu là thứ client tự khai, phần cuối là thứ
 * proxy thật sự nhìn thấy.
 *
 * Khi không có proxy: bỏ qua hoàn toàn các header đó.
 */
export function clientIp(req: IncomingMessage): string {
    if (config.panel.trustProxy) {
        const cf = req.headers['cf-connecting-ip'];
        if (typeof cf === 'string' && cf.trim()) return cf.trim();
        const forwarded = req.headers['x-forwarded-for'];
        const chain = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
        if (chain) {
            const hops = chain.split(',').map(hop => hop.trim()).filter(Boolean);
            if (hops.length) return hops[hops.length - 1];
        }
    }
    return req.socket.remoteAddress || 'unknown';
}

/** Đường dẫn đã bỏ query. Query không được log ở đâu cả — phase 2 sẽ có `code` của OAuth2 trong đó. */
export function pathOf(req: IncomingMessage): string {
    const url = req.url || '/';
    const cut = url.indexOf('?');
    return cut === -1 ? url : url.slice(0, cut);
}
