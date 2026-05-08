import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder,
    TextChannel,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import prisma from '../lib/prisma';
import {
    cancelGiveaway,
    createGiveaway,
    endGiveaway,
    GIVEAWAY_BANNER,
    parseDuration
} from '../systems/giveawayManager';

function setInputValue(input: TextInputBuilder, value: string | number | null | undefined) {
    if (value !== null && value !== undefined && String(value).trim()) {
        input.setValue(String(value));
    }
    return input;
}

function buildGiveawayCreateModal(interaction: ChatInputCommandInteraction) {
    const modal = new ModalBuilder()
        .setCustomId('giveaway_quick_modal')
        .setTitle('Tạo Giveaway');

    const title = setInputValue(
        new TextInputBuilder().setCustomId('title').setLabel('Tiêu đề').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true),
        interaction.options.getString('title')
    );
    const prize = setInputValue(
        new TextInputBuilder().setCustomId('prize').setLabel('Phần thưởng').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(true),
        interaction.options.getString('prize')
    );
    const duration = setInputValue(
        new TextInputBuilder().setCustomId('duration').setLabel('Thời lượng (VD: 30m, 2h, 3d)').setStyle(TextInputStyle.Short).setRequired(true),
        interaction.options.getString('duration')
    );
    const winners = setInputValue(
        new TextInputBuilder().setCustomId('winners').setLabel('Số winner').setStyle(TextInputStyle.Short).setRequired(true),
        interaction.options.getInteger('winners') || 1
    );
    const description = setInputValue(
        new TextInputBuilder().setCustomId('description').setLabel('Mô tả').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false),
        interaction.options.getString('description')
    );

    modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(title),
        new ActionRowBuilder<TextInputBuilder>().addComponents(prize),
        new ActionRowBuilder<TextInputBuilder>().addComponents(duration),
        new ActionRowBuilder<TextInputBuilder>().addComponents(winners),
        new ActionRowBuilder<TextInputBuilder>().addComponents(description)
    );

    return modal;
}

export default {
    data: new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Quản lý giveaway Stella')
        .addSubcommand(sub =>
            sub.setName('create')
                .setDescription('Tạo giveaway mới')
                .addStringOption(option => option.setName('title').setDescription('Tiêu đề').setRequired(false).setMaxLength(100))
                .addStringOption(option => option.setName('prize').setDescription('Phần thưởng').setRequired(false).setMaxLength(200))
                .addStringOption(option => option.setName('duration').setDescription('VD: 30m, 2h, 3d').setRequired(false))
                .addIntegerOption(option => option.setName('winners').setDescription('Số winner').setRequired(false).setMinValue(1).setMaxValue(20))
                .addStringOption(option => option.setName('description').setDescription('Mô tả').setRequired(false).setMaxLength(1000))
                .addChannelOption(option => option.setName('channel').setDescription('Kênh đăng giveaway').setRequired(false))
                .addUserOption(option => option.setName('host').setDescription('Host giveaway').setRequired(false))
                .addRoleOption(option => option.setName('required_role').setDescription('Role bắt buộc').setRequired(false))
                .addIntegerOption(option => option.setName('min_level').setDescription('Level tối thiểu').setRequired(false).setMinValue(1))
                .addIntegerOption(option => option.setName('min_scoin').setDescription('Scoin tối thiểu').setRequired(false).setMinValue(0))
                .addIntegerOption(option => option.setName('entry_cost').setDescription('Phí tham gia bằng Scoin').setRequired(false).setMinValue(0))
                .addStringOption(option =>
                    option.setName('reward_type')
                        .setDescription('Kiểu phần thưởng')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Liên hệ host', value: 'contact_host' },
                            { name: 'Link bí mật', value: 'link' },
                            { name: 'File/link tải xuống', value: 'file' }
                        ))
                .addStringOption(option => option.setName('reward_secret').setDescription('Link/file gửi riêng winner').setRequired(false).setMaxLength(1000))
                .addStringOption(option => option.setName('media_url').setDescription('Ảnh/video showcase phần thưởng').setRequired(false))
                .addAttachmentOption(option => option.setName('media_file').setDescription('Ảnh/video upload').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('panel')
                .setDescription('Gửi panel tạo giveaway nhanh'))
        .addSubcommand(sub =>
            sub.setName('participants')
                .setDescription('Xem danh sách người tham gia')
                .addIntegerOption(option => option.setName('id').setDescription('ID giveaway').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('end')
                .setDescription('Kết thúc giveaway ngay')
                .addIntegerOption(option => option.setName('id').setDescription('ID giveaway').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('reroll')
                .setDescription('Roll thêm winner mới')
                .addIntegerOption(option => option.setName('id').setDescription('ID giveaway').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('cancel')
                .setDescription('Hủy giveaway và hoàn phí')
                .addIntegerOption(option => option.setName('id').setDescription('ID giveaway').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('Xem giveaway đang active')),

    async execute(interaction: ChatInputCommandInteraction) {
        const sub = interaction.options.getSubcommand();
        const adminOnly = ['create', 'panel', 'end', 'reroll', 'cancel'].includes(sub);
        if (adminOnly && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'Bạn cần quyền Administrator để dùng lệnh này.', flags: MessageFlags.Ephemeral });
        }

        if (sub === 'create') {
            const hasCommandInput = interaction.options.getString('title') &&
                interaction.options.getString('prize') &&
                interaction.options.getString('duration') &&
                interaction.options.getInteger('winners');

            if (!hasCommandInput) {
                return interaction.showModal(buildGiveawayCreateModal(interaction));
            }
        }

        await interaction.deferReply({ flags: sub === 'participants' ? MessageFlags.Ephemeral : undefined });

        try {
            if (sub === 'create') {
                const channel = (interaction.options.getChannel('channel') || interaction.channel) as TextChannel;
                if (!channel?.isTextBased()) return interaction.editReply('Kênh giveaway không hợp lệ.');

                const durationMs = parseDuration(interaction.options.getString('duration', true));
                const mediaFile = interaction.options.getAttachment('media_file');
                const giveaway = await createGiveaway(interaction.client, {
                    channel,
                    title: interaction.options.getString('title', true),
                    prize: interaction.options.getString('prize', true),
                    durationMs,
                    winnersCount: interaction.options.getInteger('winners', true),
                    description: interaction.options.getString('description') || 'Nhấn nút bên dưới để tham gia giveaway.',
                    hostId: interaction.options.getUser('host')?.id || interaction.user.id,
                    requiredRoleId: interaction.options.getRole('required_role')?.id || null,
                    minLevel: interaction.options.getInteger('min_level'),
                    minScoin: interaction.options.getInteger('min_scoin'),
                    entryCost: interaction.options.getInteger('entry_cost') || 0,
                    rewardType: interaction.options.getString('reward_type') || 'contact_host',
                    rewardSecret: interaction.options.getString('reward_secret'),
                    publicMediaUrl: mediaFile?.url || interaction.options.getString('media_url') || GIVEAWAY_BANNER,
                    createdBy: interaction.user.id
                });

                return interaction.editReply(`Đã tạo giveaway **#${giveaway.id}** tại <#${channel.id}>.`);
            }

            if (sub === 'panel') {
                const embed = new EmbedBuilder()
                    .setColor('#f1c40f')
                    .setTitle('Giveaway Panel')
                    .setDescription('Dùng nút bên dưới để mở form tạo giveaway nhanh. Form nhanh sẽ tạo giveaway cơ bản, các điều kiện nâng cao nên dùng `/giveaway create`.')
                    .setImage(GIVEAWAY_BANNER);
                const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId('giveaway_panel_create').setLabel('Tạo giveaway nhanh').setStyle(ButtonStyle.Success).setEmoji('🎁')
                );
                return interaction.editReply({ embeds: [embed], components: [row] });
            }

            if (sub === 'participants') {
                const id = interaction.options.getInteger('id', true);
                const entries = await prisma.giveawayEntry.findMany({ where: { giveawayId: id }, orderBy: { joinedAt: 'asc' }, take: 50 });
                const lines = entries.map((entry, index) => `**${index + 1}.** <@${entry.userId}>`).join('\n') || 'Chưa có ai tham gia.';
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#f1c40f').setTitle(`Participants #${id}`).setDescription(lines)] });
            }

            if (sub === 'list') {
                const giveaways = await prisma.giveaway.findMany({ where: { status: 'ACTIVE' }, orderBy: { endsAt: 'asc' }, take: 10 });
                const lines = giveaways.map(g => `**#${g.id}** ${g.title} - <t:${Math.floor(g.endsAt.getTime() / 1000)}:R> - <#${g.channelId}>`).join('\n') || 'Không có giveaway active.';
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#f1c40f').setTitle('Giveaway active').setDescription(lines)] });
            }

            const id = interaction.options.getInteger('id', true);
            if (sub === 'end') {
                const winners = await endGiveaway(interaction.client, id);
                return interaction.editReply(`Đã kết thúc giveaway #${id}. Winner: ${winners.length ? winners.map(w => `<@${w}>`).join(', ') : 'không có'}.`);
            }
            if (sub === 'reroll') {
                const winners = await endGiveaway(interaction.client, id, true);
                return interaction.editReply(`Đã reroll giveaway #${id}. Winner mới: ${winners.length ? winners.map(w => `<@${w}>`).join(', ') : 'không có'}.`);
            }
            await cancelGiveaway(interaction.client, id);
            return interaction.editReply(`Đã hủy giveaway #${id} và hoàn phí tham gia nếu có.`);
        } catch (error: any) {
            console.error(error);
            return interaction.editReply(error?.message || 'Đã có lỗi khi xử lý giveaway.');
        }
    }
};
