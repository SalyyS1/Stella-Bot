import prisma from '../../lib/prisma';
import { config } from '../../config';
import type { ContentRuleKey, RuleTable } from './automod-rules';

// Cấu hình automod = ngưỡng mặc định trong config.ts + phần đã bị đổi trong DB.
//
// Vì sao hai nguồn: ngưỡng nên nằm trong code để đọc được lịch sử vì sao đặt vậy, còn
// việc BẬT/TẮT phải đổi được giữa một đợt spam lúc 3h sáng — sửa config.ts thì phải
// deploy lại bot, mà lúc đó thì đợt spam đã xong từ lâu.

export type AutomodRuleKey = ContentRuleKey | 'flood' | 'duplicate';

export const ALL_RULE_KEYS: AutomodRuleKey[] = [
    'flood',
    'duplicate',
    'massMention',
    'caps',
    'inviteLink',
    'links',
    'scamLink',
    'emojiSpam',
    'newlineSpam',
    'bannedWords',
    'zalgo'
];

export const RULE_LABEL: Record<AutomodRuleKey, string> = {
    flood: 'Spam nhiều tin liên tục',
    duplicate: 'Gửi lại cùng một nội dung',
    massMention: 'Ping quá nhiều người',
    caps: 'VIẾT HOA TOÀN BỘ',
    inviteLink: 'Link mời server khác',
    links: 'Link ngoài danh sách cho phép',
    scamLink: 'Link lừa đảo / mạo danh',
    emojiSpam: 'Spam emoji',
    newlineSpam: 'Spam dòng trống',
    bannedWords: 'Từ khoá bị cấm',
    zalgo: 'Ký tự phá layout'
};

export interface AutomodSettings {
    enabled: boolean;
    rules: RuleTable & { flood?: any; duplicate?: any };
    exemptRoleIds: string[];
    exemptChannelIds: string[];
}

const CACHE_TTL_MS = 60_000;
let cache: { value: AutomodSettings; loadedAt: number; guildId: string } | null = null;

function parseCsv(raw: string | null | undefined): string[] {
    return (raw || '').split(',').map(part => part.trim()).filter(Boolean);
}

function defaults(): AutomodSettings {
    // Deep clone: người gọi nhận về object này rồi ghi đè từng luật, mà object gốc nằm
    // trong config dùng chung — sửa trực tiếp là làm bẩn ngưỡng mặc định cho cả tiến trình.
    return {
        enabled: config.automod.enabled,
        rules: JSON.parse(JSON.stringify(config.automod.defaults)),
        exemptRoleIds: [...config.automod.exemptRoleIds],
        // Ba kênh này SỐNG bằng link, và mỗi kênh đã có cổng kiểm định dạng riêng trong
        // messageCreate. Không miễn trừ thì luật `inviteLink` sẽ xoá bài quảng cáo server
        // (vốn bắt buộc phải có link mời) TRƯỚC khi publishServerAd kịp chạy — người đăng
        // chỉ thấy bài biến mất và không ai đoán được vì sao.
        exemptChannelIds: [config.channels.serverAds, config.channels.share, config.channels.showcase]
    };
}

export function invalidateAutomodCache(): void {
    cache = null;
}

export async function getAutomodSettings(guildId: string): Promise<AutomodSettings> {
    if (cache && cache.guildId === guildId && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
        return cache.value;
    }

    const merged = defaults();
    const row = await prisma.automodSetting.findUnique({ where: { guildId } }).catch(error => {
        console.error('[automod] đọc cấu hình lỗi, dùng mặc định:', error);
        return null;
    });

    if (row) {
        merged.enabled = row.enabled;
        try {
            const stored = JSON.parse(row.rules || '{}');
            for (const key of Object.keys(stored)) {
                const ruleKey = key as AutomodRuleKey;
                if (!ALL_RULE_KEYS.includes(ruleKey)) continue;
                merged.rules[ruleKey] = { ...(merged.rules as any)[ruleKey], ...stored[key] };
            }
        } catch (error) {
            // JSON hỏng không được làm automod tắt im lặng: rơi về mặc định và kêu lên.
            console.error('[automod] rules JSON hỏng, dùng ngưỡng mặc định:', error);
        }
        // Role miễn trừ trong DB CỘNG THÊM vào config, không thay thế: role tin cậy đặt
        // trong code là chốt an toàn, không nên mất chỉ vì ai đó chạy `/automod exempt`.
        merged.exemptRoleIds = [...new Set([...merged.exemptRoleIds, ...parseCsv(row.exemptRoleIds)])];
        // Kênh cũng cộng thêm, vì lý do mạnh hơn: ba kênh mặc định ở trên là điều kiện
        // để luồng quảng cáo/share hoạt động. Nếu DB ghi đè, thì lần đầu ai đó miễn trừ
        // một kênh bất kỳ sẽ âm thầm gỡ luôn ba kênh kia — và bài quảng cáo bắt đầu biến
        // mất mà không ai nối được nguyên nhân với cái lệnh đã chạy tuần trước.
        merged.exemptChannelIds = [...new Set([...merged.exemptChannelIds, ...parseCsv(row.exemptChannelIds)])];
    }

    cache = { value: merged, loadedAt: Date.now(), guildId };
    return merged;
}

async function upsert(guildId: string, data: Record<string, any>): Promise<void> {
    const existing = await prisma.automodSetting.findUnique({ where: { guildId } }).catch(() => null);
    await prisma.automodSetting.upsert({
        where: { guildId },
        update: data,
        create: {
            guildId,
            enabled: data.enabled ?? config.automod.enabled,
            rules: data.rules ?? existing?.rules ?? '{}',
            exemptRoleIds: data.exemptRoleIds ?? null,
            exemptChannelIds: data.exemptChannelIds ?? null
        }
    });
    invalidateAutomodCache();
}

export async function setAutomodEnabled(guildId: string, enabled: boolean): Promise<void> {
    await upsert(guildId, { enabled });
}

/** Ghi phần ghi đè của MỘT luật; các luật khác giữ nguyên phần đã lưu. */
export async function patchRule(guildId: string, rule: AutomodRuleKey, patch: Record<string, any>): Promise<void> {
    const row = await prisma.automodSetting.findUnique({ where: { guildId } }).catch(() => null);
    let stored: Record<string, any> = {};
    try {
        stored = JSON.parse(row?.rules || '{}');
    } catch {
        stored = {};
    }
    stored[rule] = { ...(stored[rule] || {}), ...patch };
    await upsert(guildId, { rules: JSON.stringify(stored) });
}

export async function setExemptRoles(guildId: string, roleIds: string[]): Promise<void> {
    await upsert(guildId, { exemptRoleIds: roleIds.join(',') || null });
}

export async function setExemptChannels(guildId: string, channelIds: string[]): Promise<void> {
    await upsert(guildId, { exemptChannelIds: channelIds.join(',') || null });
}
