import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client,
    EmbedBuilder,
    TextChannel
} from 'discord.js';
import { config } from '../../config';

export const USER_REPORT_KICK_PREFIX = 'userreport_kick_';

export type ReportApprovalDecision = 'approve' | 'reject';

export interface ParsedReportAction {
    decision: ReportApprovalDecision;
    targetId: string;
    token: string;
}

/** Parse custom id nhưng không coi custom id là quyền — quyền/state luôn kiểm ở DB. */
export function parseReportActionId(customId: string): ParsedReportAction | null {
    const match = new RegExp(
        `^${USER_REPORT_KICK_PREFIX}(approve|reject)_(\\d{5,25})_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$`,
        'i'
    ).exec(customId);
    if (!match) return null;
    return {
        decision: match[1].toLowerCase() as ReportApprovalDecision,
        targetId: match[2],
        token: match[3].toLowerCase()
    };
}

function approvalButtons(targetId: string, token: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`${USER_REPORT_KICK_PREFIX}approve_${targetId}_${token}`)
            .setLabel('Duyệt kick')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`${USER_REPORT_KICK_PREFIX}reject_${targetId}_${token}`)
            .setLabel('Từ chối')
            .setStyle(ButtonStyle.Secondary)
    );
}

/** Gửi proposal vào kênh log nội bộ; không ping và không đưa token vào nội dung mô tả. */
export async function sendKickApproval(options: {
    client: Client;
    guildId: string;
    targetId: string;
    token: string;
    level: number;
    reportCount: number;
    reason: string;
    evidenceUrl: string | null;
    expiresAt: Date;
}): Promise<boolean> {
    const channel = await options.client.channels.fetch(config.channels.botLog).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) return false;

    const embed = new EmbedBuilder()
        .setColor('#e74c3c')
        .setTitle('Report escalation · proposal kick')
        .setDescription(
            'Đã có đủ report độc lập để đề xuất kick. **Bot chưa kick** — chỉ Administrator ' +
            'bấm nút bên dưới mới thực hiện được.'
        )
        .addFields(
            { name: 'Mục tiêu', value: `ID: \`${options.targetId}\``, inline: true },
            { name: 'Cấp hiện tại', value: String(options.level), inline: true },
            { name: 'Report độc lập', value: String(options.reportCount), inline: true },
            { name: 'Lý do gần nhất', value: options.reason.slice(0, 1000), inline: false },
            { name: 'Bằng chứng', value: options.evidenceUrl ? options.evidenceUrl.slice(0, 300) : '*không có*', inline: false },
            { name: 'Hết hạn proposal', value: `<t:${Math.floor(options.expiresAt.getTime() / 1000)}:R>`, inline: true }
        )
        .setFooter({ text: `Server ${options.guildId} · kiểm tra hồ sơ report trước khi duyệt` })
        .setTimestamp();

    try {
        await (channel as TextChannel).send({
            embeds: [embed],
            components: [approvalButtons(options.targetId, options.token)],
            allowedMentions: { parse: [] }
        });
        return true;
    } catch (error) {
        console.error('[user-report] không gửi được proposal kick:', error);
        return false;
    }
}
