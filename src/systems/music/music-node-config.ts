// ============================================================
//  MUSIC NODE CONFIG — doc va chuan hoa env Lavalink
// ============================================================

export type LavalinkNodeConfig = {
    id: string;
    host: string;
    port: number;
    authorization: string;
    secure: boolean;
};

// lavalink-client mac dinh chi thu 5 lan cach nhau 10s roi bo han node.
// Bot va Lavalink chay o 2 deployment rieng nen bot thuong start truoc khi
// Lavalink kip tai jar/plugin; thu lai lau hon de khoi phai restart bot bang tay.
export const NODE_RETRY_AMOUNT = 30;
export const NODE_RETRY_DELAY_MS = 15_000;
// Lavalink 4.2.x doi PATCH voice cho den khi ket noi Discord voice hoan tat.
// Node remote co the vuot timeout mac dinh 10s cua lavalink-client khi host
// vua thuc day hoac route voice cham, lam mat voice token va bot vao kenh ma im.
export const NODE_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Doc prefix moi lan goi thay vi cache o top-level.
 * dotenv.config() chay sau khi cac module da duoc require, nen doc mot lan
 * o top-level co the lay gia tri truoc khi .env kip nap.
 */
export function getMusicPrefix() {
    return process.env.MUSIC_PREFIX || 's!';
}

function parseBoolean(value: unknown, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function normalizeNode(node: any, index: number): LavalinkNodeConfig | null {
    if (!node || typeof node !== 'object') return null;
    const host = String(node.host || '').trim();
    const authorization = String(node.authorization || node.password || '').trim();
    const port = Number(node.port || (parseBoolean(node.secure) ? 443 : 2333));
    if (!host || !authorization || !Number.isFinite(port)) return null;

    return {
        id: String(node.id || `Stella Node ${index + 1}`),
        host,
        port,
        authorization,
        secure: parseBoolean(node.secure, port === 443)
    };
}

export function getLavalinkNodes(): LavalinkNodeConfig[] {
    const rawNodes = process.env.LAVALINK_NODES?.trim();
    if (rawNodes) {
        try {
            const parsed = JSON.parse(rawNodes);
            const list = Array.isArray(parsed) ? parsed : [parsed];
            return list.map((node, index) => normalizeNode(node, index)).filter(Boolean) as LavalinkNodeConfig[];
        } catch {
            console.warn('LAVALINK_NODES is not valid JSON. Falling back to LAVALINK_HOST/LAVALINK_PORT.');
        }
    }

    const node = normalizeNode({
        id: process.env.LAVALINK_NODE_ID || 'Stella Main',
        host: process.env.LAVALINK_HOST,
        port: process.env.LAVALINK_PORT,
        authorization: process.env.LAVALINK_PASSWORD,
        secure: process.env.LAVALINK_SECURE
    }, 0);
    return node ? [node] : [];
}

export function lavalinkConfigured() {
    return getLavalinkNodes().length > 0;
}
