import prisma from '../../lib/prisma';
import { config } from '../../config';
import type { AutomodRuleKey } from './automod-settings';

// Lượt vi phạm automod và ngưỡng leo thang.
//
// Strike ghi vào DB (khác với bộ đếm flood trong RAM) vì đây là thứ mod cần tra lại sau
// vài giờ: "người này hôm nay chạm luật mấy lần rồi?" Mất khi restart là mất đúng thông
// tin đang cần.

export interface EscalationTier {
    strikes: number;
    action: 'warn' | 'timeout';
    durationMs?: number;
}

export interface StrikeResult {
    count: number;
    /** Mốc vừa chạm ĐÚNG ở lượt này. null = chưa tới mốc nào mới. */
    tier: EscalationTier | null;
}

// Dọn strike quá hạn. Không cần scheduler riêng: bảng này chỉ được ghi khi có người vi
// phạm, nên treo việc dọn vào chính đường ghi là đủ và không thêm một nhịp nền nào nữa.
const PRUNE_PERIOD_MS = 60 * 60_000;
const STRIKE_RETAIN_MS = 7 * 86_400_000;
let lastPruneAt = 0;

async function pruneOldStrikes(): Promise<void> {
    if (Date.now() - lastPruneAt < PRUNE_PERIOD_MS) return;
    lastPruneAt = Date.now();
    await prisma.automodStrike
        .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - STRIKE_RETAIN_MS) } } })
        .catch(error => console.error('[automod] dọn strike cũ lỗi:', error));
}

export async function countStrikes(userId: string, windowMs = config.automod.strikeWindowMs): Promise<number> {
    return prisma.automodStrike
        .count({ where: { userId, createdAt: { gte: new Date(Date.now() - windowMs) } } })
        .catch(() => 0);
}

/**
 * Ghi một lượt vi phạm và cho biết nó có vừa chạm mốc leo thang nào không.
 *
 * Chỉ báo mốc khi số strike KHỚP CHÍNH XÁC ngưỡng, không phải khi vượt: nếu dùng `>=`
 * thì từ strike thứ 5 trở đi mỗi tin đều sinh một cảnh báo mới cho mod, và kênh log
 * biến thành đúng cái nó đang cố giúp mod tránh.
 */
export async function recordStrike(
    userId: string,
    rule: AutomodRuleKey,
    channelId: string | null
): Promise<StrikeResult> {
    await prisma.automodStrike
        .create({ data: { userId, rule, channelId } })
        .catch(error => console.error('[automod] ghi strike lỗi:', error));
    void pruneOldStrikes();

    const count = await countStrikes(userId);
    const tier = (config.automod.escalation as EscalationTier[]).find(entry => entry.strikes === count) || null;
    return { count, tier };
}

export async function listRecentStrikes(userId: string, take = 15) {
    return prisma.automodStrike
        .findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take })
        .catch(() => []);
}

/** Xoá strike của một người — dùng khi mod bấm "Bỏ qua" hoặc đã xử lý bằng hình phạt. */
export async function clearStrikes(userId: string): Promise<number> {
    const result = await prisma.automodStrike.deleteMany({ where: { userId } }).catch(() => ({ count: 0 }));
    return result.count;
}
