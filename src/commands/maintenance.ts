import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { clearMaintenanceTarget, MaintenanceTarget } from '../systems/maintenanceManager';
import { config } from '../config';
import { backfillVotesAndScores } from '../systems/voteBackfillManager';
import { publishEligibleShowcases } from '../systems/showcaseManager';

export default {
    data: new SlashCommandBuilder()
        .setName('maintenance')
        .setDescription('Quản lý dọn kênh Stella (Admin)')
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Clear kênh request/server ads và đăng lại hướng dẫn')
                .addStringOption(option =>
                    option
                        .setName('target')
                        .setDescription('Kênh cần clear')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Request Paid', value: 'requestPaid' },
                            { name: 'Request Free', value: 'requestFree' },
                            { name: 'Server Ads', value: 'serverAds' },
                            { name: 'All', value: 'all' }
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('backfill-votes')
                .setDescription('Quét showcase/share để gán reaction thiếu và tính lại điểm vote')
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.memberPermissions?.has('Administrator')) {
            return interaction.reply({ content: `${config.ui.emojis.error} Bạn không có quyền dùng lệnh này.`, flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (interaction.options.getSubcommand() === 'backfill-votes') {
            const result = await backfillVotesAndScores(interaction.client);
            const published = await publishEligibleShowcases(interaction.client);
            return interaction.editReply(`${config.ui.emojis.success} Backfill xong: scanned ${result.scanned}, reacted ${result.reacted}, votes ${result.votes}, published ${published}.`);
        }

        const target = interaction.options.getString('target', true);
        const targets: MaintenanceTarget[] = target === 'all'
            ? ['requestPaid', 'requestFree', 'serverAds']
            : [target as MaintenanceTarget];

        const results: string[] = [];
        for (const item of targets) {
            try {
                const deleted = await clearMaintenanceTarget(interaction.client, item, interaction.user.id);
                results.push(`${item}: OK (${deleted} tin nhắn)`);
            } catch (error) {
                results.push(`${item}: Lỗi - ${String(error).slice(0, 300)}`);
            }
        }

        await interaction.editReply(`${config.ui.emojis.success} Đã clear xong:\n${results.join('\n')}`);
    }
};
