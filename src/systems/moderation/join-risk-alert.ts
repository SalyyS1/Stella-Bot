import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    EmbedBuilder,
    GuildMember,
    MessageFlags,
    PermissionFlagsBits
} from 'discord.js';
import { config } from '../../config';
import { sendMessageLog } from '../logs/message-log-sender';
import { safeInteractionReply } from '../../utils/interaction-safe-reply';
import { banMember, kickMember } from './mod-actions';
import { createModCase } from './mod-case-manager';

// Cảnh báo mod khi một tài khoản đáng ngờ vào server.
//
// Vì sao đáng có: raid thật không đến bằng một acc, nó đến bằng ba mươi acc tạo cùng
// ngày, không avatar, tên có bốn số ở cuối. Bot KHÔNG tự kick — dấu hiệu này cũng đúng
// với một người thật vừa lập Discord để vào server bạn bè, và kick họ là mất một member
// thật. Nên bot chỉ đặt sẵn nút để mod bấm trong hai giây nếu đúng là raid.

export interface RiskSignals {
    reasons: string[];
    accountAgeDays: number;
}

// Tên kiểu "user1938471" / "abcxkqoz": mẫu mặc định của acc tạo hàng loạt.
const BULK_NAME_PATTERNS = [
    { pattern: /\d{4,}$/, label: 'tên kết thúc bằng ≥ 4 chữ số' },
    { pattern: /^[a-z]{8,}$/, label: 'tên toàn chữ thường không có nghĩa' }
];

export function assessJoinRisk(member: GuildMember, accountAgeDays: number): RiskSignals {
    const reasons: string[] = [];

    if (accountAgeDays < config.invites.minAccountAgeDays) {
        reasons.push(`tài khoản mới **${accountAgeDays} ngày** (ngưỡng ${config.invites.minAccountAgeDays})`);
    }
    // `avatar` null = đang dùng ảnh mặc định của Discord.
    if (!member.user.avatar) reasons.push('không có avatar');

    for (const entry of BULK_NAME_PATTERNS) {
        if (entry.pattern.test(member.user.username)) {
            reasons.push(entry.label);
            break;
        }
    }

    return { reasons, accountAgeDays };
}

function riskRow(userId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`joinrisk_kick_${userId}`).setLabel('Kick').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`joinrisk_ban_${userId}`).setLabel('Ban').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`joinrisk_ignore_${userId}`).setLabel('Bỏ qua').setStyle(ButtonStyle.Success)
    );
}

/** Đăng cảnh báo nếu acc có ít nhất HAI dấu hiệu, hoặc acc quá mới. */
export async function reportJoinRisk(member: GuildMember, accountAgeDays: number): Promise<boolean> {
    const risk = assessJoinRisk(member, accountAgeDays);
    // Một dấu hiệu đơn lẻ là quá dễ trùng với người thật: rất nhiều người không đặt
    // avatar. Chỉ báo khi có hai dấu hiệu, hoặc khi acc mới (dấu hiệu mạnh nhất).
    const tooYoung = accountAgeDays < config.invites.minAccountAgeDays;
    if (risk.reasons.length < 2 && !tooYoung) return false;

    await sendMessageLog(member.client, {
        embeds: [new EmbedBuilder()
            .setColor('#e67e22')
            .setTitle('Tài khoản đáng ngờ vừa vào server')
            .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
            .setDescription(
                `<@${member.id}> (${member.user.tag})\n` +
                `Tạo: <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n\n` +
                `**Dấu hiệu:**\n${risk.reasons.map(reason => `• ${reason}`).join('\n')}\n\n` +
                '-# Bot không tự xử. Bấm nút nếu đúng là acc rác.'
            )
            .setTimestamp()],
        components: [riskRow(member.id)]
    });
    return true;
}

function resolvedRow(label: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('joinrisk_done').setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(true)
    );
}

/** customId: `joinrisk_<kick|ban|ignore>_<userId>` */
export async function handleJoinRiskButton(interaction: ButtonInteraction): Promise<void> {
    const emojis = config.ui.emojis;
    const [, action, targetId] = interaction.customId.split('_');
    if (!action || !targetId || !interaction.guild) return;

    // Nút nằm trong kênh log nên chỉ mod thấy — nhưng đó là quyền của kênh, không phải
    // của nút. Kiểm lại ở đây.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.KickMembers)) {
        await safeInteractionReply(interaction, {
            content: `${emojis.error} Bạn cần quyền Kick Members để dùng nút này.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (action === 'ignore') {
        await interaction.update({ components: [resolvedRow(`Đã bỏ qua bởi ${interaction.user.username}`)] });
        return;
    }

    const actor = interaction.member && 'roles' in interaction.member
        ? interaction.member
        : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!actor || !('roles' in actor)) return;

    const target = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (!target) {
        await createModCase({
            targetId,
            actorId: interaction.user.id,
            kind: 'NOTE',
            reason: 'Định xử acc đáng ngờ nhưng người đó đã rời server'
        });
        await interaction.update({ components: [resolvedRow('Người này đã rời server')] });
        return;
    }

    try {
        // kickMember/banMember tự kiểm thứ bậc role, tự DM lý do, tự ghi ModCase và tự
        // đăng ký với anti-raid để lượt xử này không bị tính là dấu hiệu raid.
        const reason = 'Tài khoản đáng ngờ lúc vào server (mod xác nhận)';
        const result = action === 'ban'
            ? await banMember({ guild: interaction.guild, actor: actor as any }, target, reason, 1)
            : await kickMember({ guild: interaction.guild, actor: actor as any }, target, reason);
        await interaction.update({
            components: [resolvedRow(`Đã ${action === 'ban' ? 'ban' : 'kick'} · hồ sơ #${result.caseId}`)]
        });
    } catch (error: any) {
        await safeInteractionReply(interaction, {
            content: `${emojis.error} ${error?.message || 'Không xử được.'}`,
            flags: MessageFlags.Ephemeral
        });
    }
}
