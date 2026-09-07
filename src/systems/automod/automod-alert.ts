import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    Client,
    EmbedBuilder,
    Message,
    MessageFlags,
    PermissionFlagsBits
} from 'discord.js';
import { config } from '../../config';
import { sendMessageLog } from '../logs/message-log-sender';
import { createModCase, notifyWarnTarget } from '../moderation/mod-case-manager';
import { timeoutMember } from '../moderation/mod-actions';
import { safeInteractionReply } from '../../utils/interaction-safe-reply';
import { clearStrikes, type EscalationTier } from './automod-strikes';
import { RULE_LABEL, type AutomodStrikeKey } from './automod-settings';

// Log vi phạm + cảnh báo mod.
//
// Saly chốt automod KHÔNG tự phạt. Nhưng "chỉ báo mod" mà báo dở thì tệ hơn không báo:
// mod đọc xong vẫn phải tự mở lệnh, tự gõ id, tự chọn thời lượng — và lúc đó đợt spam đã
// chạy thêm hai phút. Nên cảnh báo ở đây đi kèm nút bấm một phát là xong, còn quyết định
// vẫn là của người.

export interface ViolationLogInput {
    client: Client;
    userId: string;
    userTag: string;
    channelId: string;
    rule: AutomodStrikeKey;
    detail: string;
    content: string;
    strikeCount: number;
}

interface DedupeEntry {
    logMessage: Message;
    count: number;
    firstAt: number;
}

// Gộp theo (người, luật): một đợt flood 30 tin không được sinh 30 embed, nếu không thì
// chính kênh log bị spam đúng lúc mod cần đọc nó nhất.
const recentLogs = new Map<string, DedupeEntry>();

function pruneDedupe(now: number): void {
    for (const [key, entry] of recentLogs) {
        if (now - entry.firstAt > config.automod.alertDedupeMs) recentLogs.delete(key);
    }
}

function violationEmbed(input: ViolationLogInput, repeats: number): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setColor('#e67e22')
        .setTitle(`Automod · ${RULE_LABEL[input.rule] || input.rule}`)
        .addFields(
            { name: 'Thành viên', value: `<@${input.userId}> (${input.userTag})`, inline: true },
            { name: 'Kênh', value: `<#${input.channelId}>`, inline: true },
            {
                name: 'Strike',
                value: `${input.strikeCount} lượt / ${Math.round(config.automod.strikeWindowMs / 60_000)} phút`,
                inline: true
            },
            { name: 'Lý do', value: input.detail.slice(0, 1000), inline: false }
        )
        .setFooter({ text: 'Tin đã bị xoá · bot không tự phạt' })
        .setTimestamp();

    if (input.content.trim()) {
        // Backtick trong nội dung sẽ phá code block và làm phần sau của embed thành
        // markdown thường — đổi sang dấu nháy nhìn giống nhưng vô hại.
        embed.addFields({
            name: 'Nội dung',
            value: `\`\`\`${input.content.replace(/`/g, '´').slice(0, 900)}\`\`\``,
            inline: false
        });
    }
    if (repeats > 1) {
        embed.addFields({ name: 'Số lần trong đợt này', value: `**${repeats}** tin`, inline: true });
    }
    return embed;
}

/** Ghi log một lượt vi phạm; lượt lặp lại trong cửa sổ gộp SỬA embed cũ thay vì đăng mới. */
export async function logViolation(input: ViolationLogInput): Promise<void> {
    const now = Date.now();
    pruneDedupe(now);

    const key = `${input.userId}:${input.rule}`;
    const existing = recentLogs.get(key);
    if (existing) {
        existing.count += 1;
        const edited = await existing.logMessage
            .edit({ embeds: [violationEmbed(input, existing.count)] })
            .catch(() => null);
        // Sửa thất bại (tin log bị xoá tay) thì bỏ khoá gộp để lượt sau đăng embed mới,
        // chứ không mất log im lặng.
        if (!edited) recentLogs.delete(key);
        return;
    }

    const sent = await sendMessageLog(input.client, { embeds: [violationEmbed(input, 1)] });
    if (sent) recentLogs.set(key, { logMessage: sent, count: 1, firstAt: now });
}

function alertRow(userId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`automod_timeout10_${userId}`).setLabel('Timeout 10 phút').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`automod_timeout60_${userId}`).setLabel('Timeout 1 tiếng').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`automod_warn_${userId}`).setLabel('Ghi cảnh cáo').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`automod_ignore_${userId}`).setLabel('Bỏ qua · xoá strike').setStyle(ButtonStyle.Success)
    );
}

/** Embed đỏ kèm nút xử, chỉ đăng khi người đó vừa chạm một mốc leo thang. */
export async function alertModerators(input: ViolationLogInput, tier: EscalationTier): Promise<void> {
    const suggestion = tier.action === 'timeout'
        ? `timeout ${Math.round((tier.durationMs ?? 600_000) / 60_000)} phút`
        : 'ghi cảnh cáo';

    const embed = new EmbedBuilder()
        .setColor('#e74c3c')
        .setTitle(`Cần mod xem: ${input.strikeCount} lượt vi phạm automod`)
        .setDescription(
            `<@${input.userId}> đã chạm luật **${input.strikeCount} lần** trong ` +
            `${Math.round(config.automod.strikeWindowMs / 60_000)} phút.\n` +
            `Luật gần nhất: **${RULE_LABEL[input.rule] || input.rule}** — ${input.detail}\n\n` +
            `Ngưỡng này gợi ý **${suggestion}**. Bot không tự làm; bấm nút bên dưới nếu bạn đồng ý.`
        )
        .setFooter({ text: `Kênh gần nhất: #${input.channelId}` })
        .setTimestamp();

    await sendMessageLog(input.client, { embeds: [embed], components: [alertRow(input.userId)] });
}

// ============================================================
//  NÚT XỬ CỦA MOD
// ============================================================

function disabledRow(label: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('automod_done').setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(true)
    );
}

/** customId: `automod_<timeout10|timeout60|warn|ignore>_<userId>` */
export async function handleAutomodButton(interaction: ButtonInteraction): Promise<void> {
    const emojis = config.ui.emojis;
    const [, action, targetId] = interaction.customId.split('_');
    if (!action || !targetId) return;

    // Nút nằm trong kênh log nên chỉ mod thấy — nhưng "chỉ mod thấy" là quyền của kênh,
    // không phải của nút. Kiểm lại quyền ở đây để một link tin nhắn bị dán ra ngoài
    // không biến thành nút timeout cho bất kỳ ai.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
        await safeInteractionReply(interaction, {
            content: `${emojis.error} Bạn cần quyền Moderate Members để dùng nút này.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    if (!interaction.guild) return;

    const actor = interaction.member && 'roles' in interaction.member
        ? interaction.member
        : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!actor || !('roles' in actor)) return;

    try {
        if (action === 'ignore') {
            const removed = await clearStrikes(targetId);
            await createModCase({
                targetId,
                actorId: interaction.user.id,
                kind: 'NOTE',
                reason: `Mod bỏ qua cảnh báo automod (xoá ${removed} strike)`
            });
            await interaction.update({ components: [disabledRow(`Đã bỏ qua bởi ${interaction.user.username}`)] });
            return;
        }

        if (action === 'warn') {
            const record = await createModCase({
                targetId,
                actorId: interaction.user.id,
                kind: 'WARN',
                reason: 'Vi phạm automod nhiều lần',
                notifyClient: interaction.client
            });
            await notifyWarnTarget(interaction.client, targetId, 'Vi phạm automod nhiều lần', record.id);
            await interaction.update({ components: [disabledRow(`Đã ghi cảnh cáo #${record.id}`)] });
            return;
        }

        if (action === 'timeout10' || action === 'timeout60') {
            const target = await interaction.guild.members.fetch(targetId).catch(() => null);
            if (!target) {
                await safeInteractionReply(interaction, {
                    content: `${emojis.error} Người này đã rời server.`,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }
            const durationMs = action === 'timeout10' ? 10 * 60_000 : 60 * 60_000;
            // timeoutMember tự kiểm thứ bậc role (mod không xử được người ngang/cao hơn)
            // và tự ghi hồ sơ — không viết lại logic đó ở đây.
            const result = await timeoutMember(
                { guild: interaction.guild, actor: actor as any },
                target,
                durationMs,
                'Vi phạm automod nhiều lần'
            );
            await clearStrikes(targetId);
            await interaction.update({
                components: [disabledRow(`Đã timeout ${durationMs / 60_000} phút · hồ sơ #${result.caseId}`)]
            });
            return;
        }
    } catch (error: any) {
        await safeInteractionReply(interaction, {
            content: `${emojis.error} ${error?.message || 'Không xử được.'}`,
            flags: MessageFlags.Ephemeral
        });
    }
}
