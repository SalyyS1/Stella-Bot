export interface MinecraftAddress {
    host: string;
    port: number;
}

export interface McStatusResponse {
    online: boolean;
    host?: string;
    port?: number;
    ip_address?: string;
    version?: { name_clean?: string; name_raw?: string; name?: string };
    players?: { online?: number; max?: number };
    motd?: { clean?: string; raw?: string };
    icon?: string | null;
}

/**
 * Địa chỉ server Minecraft đã chuẩn hoá cho `/mc status` và quảng cáo server.
 *
 * Tách khỏi serverAdsManager vì hai lệnh dùng chung một cách hiểu địa chỉ — để trong đó
 * thì lệnh công cụ phải import một module của hệ quảng cáo chỉ để lấy một hàm parse.
 */
export function parseMinecraftAddress(ip: string): MinecraftAddress | null {
    const cleaned = ip.trim().replace(/^minecraft:\/\//i, '');
    if (!cleaned || /\s/.test(cleaned)) return null;
    // Nhiều hơn một dấu ":" thì từ chối hẳn. Đó hoặc là IPv6 trần (mcstatus.io nhận
    // hostname/IPv4, không nhận dạng này) hoặc là gõ nhầm — đoán bừa phần nào là port sẽ
    // gọi API với một host không phải thứ người dùng định tra.
    const parts = cleaned.split(':');
    if (parts.length > 2) return null;
    const host = parts[0];
    const port = parts[1] ? Number(parts[1]) : 25565;
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host, port };
}

/** MOTD có mã màu § và ký tự điều khiển — bỏ trước khi hiện ra Discord. */
export function cleanMinecraftText(text?: string): string {
    return (text || '').replace(/§[0-9a-fk-or]/gi, '').replace(/\s+/g, ' ').trim();
}

export async function fetchMinecraftStatus(
    address: MinecraftAddress,
    timeoutMs = 8000
): Promise<McStatusResponse> {
    const target = address.port === 25565 ? address.host : `${address.host}:${address.port}`;
    const response = await fetch(`https://api.mcstatus.io/v2/status/java/${encodeURIComponent(target)}`, {
        signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error(`mcstatus.io ${response.status}`);
    return await response.json() as McStatusResponse;
}
