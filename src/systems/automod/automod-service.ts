import { Message, PermissionFlagsBits, TextChannel } from 'discord.js';
import { config } from '../../config';
import { checkContentRules } from './automod-rules';
import { trackMessage } from './automod-flood-tracker';
import { getAutomodSettings, RULE_LABEL, type AutomodRuleKey } from './automod-settings';
import { recordStrike } from './automod-strikes';
import { alertModerators, logViolation } from './automod-alert';

// Điều phối automod cho một tin nhắn.
//
// Trả về `true` khi tin đã bị xử lý (đã xoá) để `messageCreate` dừng pipeline: một tin
// vừa bị xoá thì không nên tiếp tục được cộng XP, tính trivia hay gọi AI.

// Nhắc người vi phạm — nhưng chỉ MỘT lần mỗi 10s mỗi người. Không có cửa sổ này thì một
// đợt flood 30 tin sinh ra 30 lời nhắc, tức là bot spam kênh nhiều hơn cả người bị chặn.
const NOTICE_COOLDOWN_MS = 10_000;
const lastNotice = new Map<string, number>();

function shouldNotice(userId: string, now: number): boolean {
    const previous = lastNotice.get(userId) ?? 0;
    if (now - previous < NOTICE_COOLDOWN_MS) return false;
    lastNotice.set(userId, now);
    // Map này chỉ giữ một số nhỏ theo mỗi người đang vi phạm; dọn khi vượt ngưỡng để
    // không tích vô hạn trong tiến trình chạy nhiều tháng.
    if (lastNotice.size > 500) {
        for (const [key, at] of lastNotice) {
            if (now - at > NOTICE_COOLDOWN_MS * 10) lastNotice.delete(key);
        }
    }
    return true;
}

async function noticeMember(message: Message, rule: AutomodRuleKey, detail: string): Promise<void> {
    if (!shouldNotice(message.author.id, Date.now())) return;
    const sent = await (message.channel as TextChannel)
        .send({
            content: `<@${message.author.id}> ${config.ui.emojis.appeal} Tin của bạn bị xoá tự động: ` +
                `**${RULE_LABEL[rule] || rule}** (${detail}). Đọc lại luật ở <#${config.channels.rules}> nhé.`,
            allowedMentions: { users: [message.author.id] }
        })
        .catch(() => null);
    // Lời nhắc tự dọn: để lại thì kênh chat đầy thông báo của bot, và người vi phạm bị
    // treo bảng tên giữa kênh lâu hơn mức cần thiết.
    if (sent) setTimeout(() => sent.delete().catch(() => {}), 8_000);
}

async function isExempt(message: Message, exemptRoleIds: string[], exemptChannelIds: string[]): Promise<boolean> {
    if (exemptChannelIds.includes(message.channelId)) return true;
    const member = message.member;
    if (!member) return false;
    // Người đang dọn spam phải dán được link và ping được nhiều người. Automod chặn đúng
    // những người đang chữa cháy là kiểu hỏng tệ nhất của loại tính năng này.
    if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
    if (exemptRoleIds.length && member.roles.cache.hasAny(...exemptRoleIds)) return true;
    return false;
}

export async function runAutomod(message: Message): Promise<boolean> {
    if (!message.guild || message.author.bot) return false;

    let settings;
    try {
        settings = await getAutomodSettings(message.guild.id);
    } catch (error) {
        console.error('[automod] không đọc được cấu hình, bỏ qua tin này:', error);
        return false;
    }
    if (!settings.enabled) return false;
    if (await isExempt(message, settings.exemptRoleIds, settings.exemptChannelIds)) return false;

    const mentionCount = message.mentions.users.size + message.mentions.roles.size;
    const hit =
        checkContentRules({ content: message.content, mentionCount }, settings.rules) ||
        trackMessage(
            message.author.id,
            message.content,
            Date.now(),
            settings.rules.flood,
            settings.rules.duplicate
        );
    if (!hit) return false;

    const content = message.content;
    const channelId = message.channelId;
    const deleted = await message.delete().then(() => true).catch(() => false);

    const { count, tier } = await recordStrike(message.author.id, hit.rule as AutomodRuleKey, channelId);

    const logInput = {
        client: message.client,
        userId: message.author.id,
        userTag: message.author.tag,
        channelId,
        rule: hit.rule as AutomodRuleKey,
        detail: hit.detail,
        content,
        strikeCount: count
    };
    await logViolation(logInput).catch(error => console.error('[automod] log lỗi:', error));

    // Mốc leo thang chỉ là GỢI Ý cho mod (Saly chốt bot không tự phạt) — xem
    // config.automod.escalation.
    if (tier) {
        await alertModerators(logInput, tier).catch(error => console.error('[automod] cảnh báo mod lỗi:', error));
    }

    if (deleted) await noticeMember(message, hit.rule as AutomodRuleKey, hit.detail);
    return deleted;
}
