import { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pathOf, sendJson, sendText } from './http-helpers';
import { serveStaticFile } from './static-file-server';

// Router của panel. Một bảng route, khớp lần lượt — đủ cho một panel chỉ đọc.
//
// Phase 1 chỉ có /healthz và file tĩnh. Cổng admin (phase 2) và /api (phase 3) sẽ cắm
// vào đúng chỗ đã đánh dấu bên dưới, ở MỘT chỗ duy nhất: rải kiểm quyền vào từng
// handler là sẽ có handler bị quên.

export type PanelHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

export async function handlePanelRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method || 'GET';
    const urlPath = pathOf(req);

    // Panel chỉ đọc nên chỉ có GET và HEAD. POST/PUT/DELETE bị chặn ngay ở đây, trước
    // khi tới bất kỳ handler nào — đây là tầng chặn đầu tiên của chốt "chỉ đọc".
    if (method !== 'GET' && method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return sendJson(res, 405, { error: 'method_not_allowed' });
    }

    if (urlPath === '/healthz') {
        // Cố tình chỉ có { ok }. Endpoint sức khoẻ là endpoint công khai: uptime, phiên
        // bản, tên guild hay số thành viên lọt ra đây là thông tin cho người lạ.
        return sendJson(res, 200, { ok: true });
    }

    if (urlPath === '/robots.txt') {
        // Panel quản trị không có gì để đánh chỉ mục. Đây không phải cổng bảo mật
        // (crawler xấu bỏ qua file này) — nó chỉ để panel không lọt lên kết quả tìm kiếm.
        return sendText(res, 200, 'User-agent: *\nDisallow: /\n');
    }

    // --- Chỗ cắm của phase 2 (/auth/*) và phase 3 (/api/*) ---
    if (urlPath === '/api' || urlPath.startsWith('/api/') || urlPath.startsWith('/auth/')) {
        return sendJson(res, 404, { error: 'not_found' });
    }

    const result = await serveStaticFile(req, res, urlPath);
    if (result === 'sent') return;

    // Đường dẫn bị từ chối (thoát khỏi web/out, mã hoá sai, byte null, đuôi lạ) thì
    // 404 CỨNG, không fallback. Fallback ở đây là một lần thử traversal nhận về HTTP
    // 200 kèm trang panel — không rò rỉ gì, nhưng làm mọi lần thử trông như thành công
    // trong log, và đó là cách người ta bỏ sót một cuộc dò thật.
    if (result === 'rejected') return sendJson(res, 404, { error: 'not_found' });

    // Thiếu file có phần mở rộng (/app.js, /logo.png) cũng 404: trả HTML cho một file
    // .js bị thiếu làm trình duyệt báo lỗi cú pháp lạ và che mất lỗi build thật.
    if (path.extname(urlPath)) return sendJson(res, 404, { error: 'not_found' });

    // SPA fallback: đường dẫn không có đuôi thì trả index.html để router phía client
    // xử lý. Nếu chưa build panel (`web/out` trống) thì nói rõ, không phải trang trắng
    // khiến người ta tưởng bot lỗi.
    if (await serveStaticFile(req, res, '/index.html') === 'sent') return;
    return sendJson(res, 404, { error: 'panel_not_built' });
}
