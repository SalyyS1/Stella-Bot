import { createServer, Server } from 'node:http';
import { Client } from 'discord.js';
import { config } from '../config';
import { handlePanelRequest } from './panel-router';
import { sendJson } from './http-helpers';
import { staticRoot } from './static-file-server';

// Panel HTTP chạy trong cùng process với bot.
//
// Nguyên tắc số một của file này: KHÔNG ĐƯỢC LÀM CHẾT BOT. Panel là phần thêm; port bị
// chiếm, handler ném lỗi, hay `web/out` không tồn tại đều chỉ được làm mất panel. Vì
// vậy: không `process.exit`, không để exception nào thoát ra event loop, và mặc định
// tắt.

let server: Server | null = null;

export function startPanel(client: Client): Server | null {
    if (!config.panel.enabled) {
        console.log('[panel] PANEL_ENABLED không bật — bỏ qua panel.');
        return null;
    }
    if (server) return server;

    server = createServer((req, res) => {
        // Bọc ở đây là tầng chặn cuối: một handler ném lỗi đồng bộ hay bất đồng bộ cũng
        // chỉ thành 500, không thành unhandled rejection kéo cả process.
        Promise.resolve()
            .then(() => handlePanelRequest(req, res))
            .catch(error => {
                console.error('[panel] handler lỗi:', error);
                if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
                else res.destroy();
            });
    });

    // Trần thời gian: một kết nối mở mà gửi header nhỏ giọt sẽ giữ tài nguyên của bot.
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    // Trần kết nối đồng thời. Panel admin có vài người dùng; con số này để một trận
    // flood không biến thành hàng nghìn socket trong process đang giữ gateway Discord.
    server.maxConnections = 64;

    server.on('error', error => {
        // Port bị chiếm là mất panel, không phải mất bot.
        console.error('[panel] server lỗi, panel tắt:', error);
        server = null;
    });

    server.listen(config.panel.port, config.panel.host, () => {
        const publicWarning = config.panel.host === '0.0.0.0'
            ? ' — CẢNH BÁO: đang bind ra mạng, chỉ làm vậy khi đã có HTTPS đứng trước'
            : '';
        console.log(
            `[panel] đang chạy tại http://${config.panel.host}:${config.panel.port}` +
            ` (tĩnh: ${staticRoot()})${publicWarning}`
        );
    });

    // client chưa dùng ở phase 1. Phase 2 cần nó để kiểm role admin trong guild —
    // giữ tham số ở đây để chữ ký hàm không đổi khi cắm cổng admin vào.
    void client;
    return server;
}

export async function stopPanel(): Promise<void> {
    const current = server;
    server = null;
    if (!current) return;
    await new Promise<void>(resolve => current.close(() => resolve()));
}
