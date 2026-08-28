import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../config';
import { applySecurityHeaders } from './http-helpers';

// Serve thư mục build tĩnh của panel (`web/out`).
//
// CHỐT QUAN TRỌNG NHẤT CỦA FILE NÀY: path traversal. Ghép đường dẫn từ URL vào thư mục
// gốc mà không kiểm lại kết quả là để `GET /../../.env` đọc được đúng file chứa
// BOT_TOKEN và DATABASE_URL. Cách chặn duy nhất đáng tin: resolve ra đường dẫn tuyệt
// đối rồi kiểm nó CÓ NẰM TRONG thư mục gốc hay không — không phải lọc chuỗi "..", vì
// URL còn mã hoá được thành %2e%2e và lọc chuỗi sẽ luôn thiếu một biến thể.

const ROOT = path.resolve(process.cwd(), config.panel.staticDir);

// Danh sách đuôi CHO PHÉP, không phải danh sách đuôi chặn. Đuôi lạ (.ts, .env, .db,
// .map của server) không ra khỏi đây, kể cả khi ai đó vô tình copy file vào web/out.
const MIME_BY_EXT: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8'
};

export interface ResolvedAsset {
    absolutePath: string;
    contentType: string;
    size: number;
    immutable: boolean;
}

/**
 * Ba kết quả, không phải hai. Router cần phân biệt "không có file nhưng là đường dẫn
 * hợp lệ" (được fallback sang index.html cho router phía client) với "đường dẫn bị từ
 * chối" (thoát khỏi thư mục gốc, mã hoá sai, byte null, đuôi lạ) — cái sau phải 404
 * cứng. Trả cùng một kết quả cho cả hai là một lần thử traversal nhận về HTTP 200, và
 * người đọc log sẽ không thấy gì đáng ngờ.
 */
export type AssetLookup =
    | { kind: 'file'; asset: ResolvedAsset }
    | { kind: 'missing' }
    | { kind: 'rejected' };

export async function lookupAsset(urlPath: string): Promise<AssetLookup> {
    let decoded: string;
    try {
        decoded = decodeURIComponent(urlPath);
    } catch {
        // URL mã hoá sai (ví dụ '%zz') — không đoán ý.
        return { kind: 'rejected' };
    }
    // Byte null trong đường dẫn là mánh cắt chuỗi ở tầng dưới.
    if (decoded.includes('\0')) return { kind: 'rejected' };

    // Bỏ mọi dấu '/' đầu TRƯỚC khi resolve: path.resolve(root, '/etc/passwd') trả về
    // '/etc/passwd', không phải root + '/etc/passwd'.
    const relative = decoded.replace(/^\/+/, '');
    const candidate = relative === '' ? 'index.html' : relative;
    const absolute = path.resolve(ROOT, candidate);

    // Cổng chặn thật: kết quả phải nằm trong ROOT.
    if (absolute !== ROOT && !absolute.startsWith(ROOT + path.sep)) return { kind: 'rejected' };

    // Kiểm đuôi TRƯỚC khi hỏi ổ đĩa. Hai lý do: `/.env` hay `/index.ts` bị từ chối vì
    // *loại* đường dẫn, không phụ thuộc file có tồn tại hay không; và như vậy `stat`
    // không trở thành máy dò "file này có tồn tại không" cho đường dẫn bất kỳ.
    // Đường dẫn không có đuôi vẫn đi tiếp: nó có thể là thư mục (/orders → /orders/index.html).
    const ext = path.extname(absolute).toLowerCase();
    if (ext && !MIME_BY_EXT[ext]) return { kind: 'rejected' };

    const info = await stat(absolute).catch(() => null);
    // Thư mục thì thử index.html bên trong (Next.js xuất /orders/index.html).
    if (info?.isDirectory()) return lookupAsset(`${relative.replace(/\/+$/, '')}/index.html`);
    if (!info?.isFile()) return { kind: 'missing' };

    // File không có đuôi (LICENSE, Procfile...) cũng không ra khỏi đây.
    const contentType = MIME_BY_EXT[ext];
    if (!contentType) return { kind: 'rejected' };

    return {
        kind: 'file',
        asset: {
            absolutePath: absolute,
            contentType,
            // Next.js đặt hash vào tên file trong /_next/static — những file đó bất biến.
            // index.html thì KHÔNG được cache: cache nó là admin dùng panel bản cũ mà
            // không biết vì sao thiếu tính năng.
            immutable: absolute.includes(`${path.sep}_next${path.sep}static${path.sep}`),
            size: info.size
        }
    };
}

/** Tiện cho test và cho chỗ chỉ cần biết có file hay không. */
export async function resolveAsset(urlPath: string): Promise<ResolvedAsset | null> {
    const result = await lookupAsset(urlPath);
    return result.kind === 'file' ? result.asset : null;
}

export type StaticResult = 'sent' | 'missing' | 'rejected';

/** Gửi file nếu có. Trả lý do để router quyết định fallback hay 404 cứng. */
export async function serveStaticFile(
    req: IncomingMessage,
    res: ServerResponse,
    urlPath: string
): Promise<StaticResult> {
    const result = await lookupAsset(urlPath);
    if (result.kind !== 'file') return result.kind;
    const asset = result.asset;

    applySecurityHeaders(res);
    res.writeHead(200, {
        'Content-Type': asset.contentType,
        'Content-Length': asset.size,
        'Cache-Control': asset.immutable ? 'public, max-age=31536000, immutable' : 'no-store'
    });

    if (req.method === 'HEAD') {
        res.end();
        return 'sent';
    }

    const stream = createReadStream(asset.absolutePath);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return 'sent';
}

/** Dùng cho log/self-check: thư mục gốc đã resolve. */
export function staticRoot(): string {
    return ROOT;
}
