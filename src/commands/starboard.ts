import {
    ChannelType,
    ChatInputCommandInteraction,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import { config } from '../config';
import { disableStarboard, getStarboardConfig, setStarboard } from '../systems/utility/starboard-manager';

export default {
    data: new SlashCommandBuilder()
        .setName('starboard')
        .setDescription('Bảng vàng — tin được nhiều sao sẽ được đăng lại (thay starboard Carl-bot)')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Chọn kênh bảng vàng')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('Kênh đăng').setRequired(true).addChannelTypes(ChannelType.GuildText))
                .addIntegerOption(option =>
                    option.setName('threshold').setDescription('Số sao cần có').setMinValue(1).setMaxValue(50)))
        .addSubcommand(sub => sub.setName('off').setDescription('Tắt starboard'))
        .addSubcommand(sub => sub.setName('status').setDescription('Xem cấu hình hiện tại'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Manage Messages.`, flags: MessageFlags.Ephemeral });
        }

        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (sub === 'setup') {
            const channel = interaction.options.getChannel('channel', true);
            const threshold = interaction.options.getInteger('threshold') ?? config.utility.starboard.threshold;
            await setStarboard(channel.id, threshold);
            return interaction.editReply(
                `${emojis.success} Bảng vàng: <#${channel.id}> · cần **${threshold}** ${config.utility.starboard.emoji}.\n` +
                `${config.utility.starboard.allowSelfStar ? '' : 'Sao tự thả cho bài của mình không được tính. '}` +
                'Rút sao xuống dưới ngưỡng thì bài tự rời bảng.'
            );
        }

        if (sub === 'off') {
            await disableStarboard();
            return interaction.editReply(`${emojis.success} Đã tắt starboard. Các bài đã đăng vẫn giữ nguyên.`);
        }

        const current = await getStarboardConfig();
        return interaction.editReply(
            current.channelId
                ? `${emojis.note} Bảng vàng: <#${current.channelId}> · ngưỡng **${current.threshold}** ${config.utility.starboard.emoji}`
                : `${emojis.note} Starboard đang tắt. Bật bằng \`/starboard setup\`.`
        );
    }
};
