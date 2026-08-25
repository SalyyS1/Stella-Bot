import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import { config } from '../config';
import { parseDurationMs, formatDuration } from '../utils/parse-duration';
import { createModCase } from '../systems/moderation/mod-case-manager';
import { listWatches, startWatch, stopWatch } from '../systems/moderation/watch-manager';

export default {
    data: new SlashCommandBuilder()
        .setName('watch')
        .setDescription('Theo dõi một thành viên — tin của họ được copy sang kênh log')
        .addSubcommand(sub =>
            sub.setName('on')
                .setDescription('Bật theo dõi')
                .addUserOption(option => option.setName('user').setDescription('Thành viên').setRequired(true))
                .addStringOption(option => option.setName('duration').setDescription('Thời hạn: 2d, 12h, 30m').setRequired(true))
                .addStringOption(option => option.setName('reason').setDescription('Lý do').setRequired(true).setMaxLength(400)))
        .addSubcommand(sub =>
            sub.setName('off')
                .setDescription('Tắt theo dõi')
                .addUserOption(option => option.setName('user').setDescription('Thành viên').setRequired(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('Ai đang bị theo dõi'))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        // Administrator, không phải ModerateMembers: đây là công cụ theo dõi người thật,
        // không phải một lệnh kiểm duyệt thường ngày.
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: `${emojis.error} Chỉ Administrator dùng được lệnh này.`, flags: MessageFlags.Ephemeral });
        }

        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (sub === 'list') {
            const rows = await listWatches();
            if (!rows.length) return interaction.editReply(`${emojis.note} Không ai đang bị theo dõi.`);
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle(`Đang theo dõi (${rows.length})`)
                    .setDescription(rows.map(row =>
                        `<@${row.userId}> · hết hạn <t:${Math.floor(row.expiresAt.getTime() / 1000)}:R>\n` +
                        `   bật bởi <@${row.actorId}> — ${row.reason}`
                    ).join('\n').slice(0, 4000))]
            });
        }

        const target = interaction.options.getUser('user', true);

        if (sub === 'off') {
            const stopped = await stopWatch(target.id);
            return interaction.editReply(
                stopped ? `${emojis.success} Đã tắt theo dõi ${target}.` : `${emojis.close} ${target} không đang bị theo dõi.`
            );
        }

        if (target.bot) return interaction.editReply(`${emojis.error} Không theo dõi bot.`);

        let durationMs: number;
        try {
            durationMs = parseDurationMs(interaction.options.getString('duration', true), {
                maxMs: config.moderation.watchMaxDays * 86_400_000,
                minMs: 60_000,
                maxLabel: `${config.moderation.watchMaxDays} ngày`
            });
        } catch (error: any) {
            return interaction.editReply(`${emojis.error} ${error.message}`);
        }

        const reason = interaction.options.getString('reason', true);
        const row = await startWatch({ userId: target.id, actorId: interaction.user.id, reason, durationMs });
        // Luôn ghi hồ sơ: theo dõi một người mà không để lại dấu vết ai bật và vì sao là
        // đúng thứ khiến tính năng này đáng ngại.
        await createModCase({
            targetId: target.id,
            actorId: interaction.user.id,
            kind: 'WATCH',
            reason: `Theo dõi ${formatDuration(durationMs)}: ${reason}`
        });

        return interaction.editReply(
            `${emojis.success} Đang theo dõi ${target} trong **${formatDuration(durationMs)}** ` +
            `(tới <t:${Math.floor(row.expiresAt.getTime() / 1000)}:f>).\n` +
            `Tin của họ sẽ được copy sang <#${config.logs.channelId}>. Đã ghi hồ sơ kiểm duyệt.`
        );
    }
};
