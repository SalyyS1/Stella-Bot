import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
    TextChannel
} from 'discord.js';
import prisma from '../lib/prisma';
import {
    cancelGiveaway,
    createGiveaway,
    endGiveaway,
    GIVEAWAY_BANNER,
    parseDuration
} from '../systems/giveawayManager';

export default {
    data: new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Quan ly giveaway Stella')
        .addSubcommand(sub =>
            sub.setName('create')
                .setDescription('Tao giveaway moi')
                .addStringOption(option => option.setName('title').setDescription('Tieu de').setRequired(true).setMaxLength(100))
                .addStringOption(option => option.setName('prize').setDescription('Phan thuong').setRequired(true).setMaxLength(200))
                .addStringOption(option => option.setName('duration').setDescription('VD: 30m, 2h, 3d').setRequired(true))
                .addIntegerOption(option => option.setName('winners').setDescription('So winner').setRequired(true).setMinValue(1).setMaxValue(20))
                .addStringOption(option => option.setName('description').setDescription('Mo ta').setRequired(false).setMaxLength(1000))
                .addChannelOption(option => option.setName('channel').setDescription('Kenh dang giveaway').setRequired(false))
                .addUserOption(option => option.setName('host').setDescription('Host giveaway').setRequired(false))
                .addRoleOption(option => option.setName('required_role').setDescription('Role bat buoc').setRequired(false))
                .addIntegerOption(option => option.setName('min_level').setDescription('Level toi thieu').setRequired(false).setMinValue(1))
                .addIntegerOption(option => option.setName('min_scoin').setDescription('Scoin toi thieu').setRequired(false).setMinValue(0))
                .addIntegerOption(option => option.setName('entry_cost').setDescription('Phi tham gia bang Scoin').setRequired(false).setMinValue(0))
                .addStringOption(option =>
                    option.setName('reward_type')
                        .setDescription('Kieu phan thuong')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Lien he host', value: 'contact_host' },
                            { name: 'Link bi mat', value: 'link' },
                            { name: 'File/link tai xuong', value: 'file' }
                        ))
                .addStringOption(option => option.setName('reward_secret').setDescription('Link/file gui rieng winner').setRequired(false).setMaxLength(1000))
                .addStringOption(option => option.setName('media_url').setDescription('Anh/video showcase phan thuong').setRequired(false))
                .addAttachmentOption(option => option.setName('media_file').setDescription('Anh/video upload').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('panel')
                .setDescription('Gui panel tao giveaway nhanh'))
        .addSubcommand(sub =>
            sub.setName('participants')
                .setDescription('Xem danh sach nguoi tham gia')
                .addIntegerOption(option => option.setName('id').setDescription('ID giveaway').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('end')
                .setDescription('Ket thuc giveaway ngay')
                .addIntegerOption(option => option.setName('id').setDescription('ID giveaway').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('reroll')
                .setDescription('Roll them winner moi')
                .addIntegerOption(option => option.setName('id').setDescription('ID giveaway').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('cancel')
                .setDescription('Huy giveaway va hoan phi')
                .addIntegerOption(option => option.setName('id').setDescription('ID giveaway').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('Xem giveaway dang active')),

    async execute(interaction: ChatInputCommandInteraction) {
        const sub = interaction.options.getSubcommand();
        const adminOnly = ['create', 'panel', 'end', 'reroll', 'cancel'].includes(sub);
        if (adminOnly && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'Ban can quyen Administrator de dung lenh nay.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: sub === 'participants' ? MessageFlags.Ephemeral : undefined });

        try {
            if (sub === 'create') {
                const channel = (interaction.options.getChannel('channel') || interaction.channel) as TextChannel;
                if (!channel?.isTextBased()) return interaction.editReply('Kenh giveaway khong hop le.');

                const durationMs = parseDuration(interaction.options.getString('duration', true));
                const mediaFile = interaction.options.getAttachment('media_file');
                const giveaway = await createGiveaway(interaction.client, {
                    channel,
                    title: interaction.options.getString('title', true),
                    prize: interaction.options.getString('prize', true),
                    durationMs,
                    winnersCount: interaction.options.getInteger('winners', true),
                    description: interaction.options.getString('description') || 'Nhan nut ben duoi de tham gia giveaway.',
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

                return interaction.editReply(`Da tao giveaway **#${giveaway.id}** tai <#${channel.id}>.`);
            }

            if (sub === 'panel') {
                const embed = new EmbedBuilder()
                    .setColor('#f1c40f')
                    .setTitle('Giveaway Panel')
                    .setDescription('Dung nut ben duoi de mo form tao giveaway nhanh. Form nhanh se tao giveaway co ban, cac dieu kien nang cao nen dung `/giveaway create`.')
                    .setImage(GIVEAWAY_BANNER);
                const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId('giveaway_panel_create').setLabel('Tao giveaway nhanh').setStyle(ButtonStyle.Success).setEmoji('🎁')
                );
                return interaction.editReply({ embeds: [embed], components: [row] });
            }

            if (sub === 'participants') {
                const id = interaction.options.getInteger('id', true);
                const entries = await prisma.giveawayEntry.findMany({ where: { giveawayId: id }, orderBy: { joinedAt: 'asc' }, take: 50 });
                const lines = entries.map((entry, index) => `**${index + 1}.** <@${entry.userId}>`).join('\n') || 'Chua co ai tham gia.';
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#f1c40f').setTitle(`Participants #${id}`).setDescription(lines)] });
            }

            if (sub === 'list') {
                const giveaways = await prisma.giveaway.findMany({ where: { status: 'ACTIVE' }, orderBy: { endsAt: 'asc' }, take: 10 });
                const lines = giveaways.map(g => `**#${g.id}** ${g.title} - <t:${Math.floor(g.endsAt.getTime() / 1000)}:R> - <#${g.channelId}>`).join('\n') || 'Khong co giveaway active.';
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#f1c40f').setTitle('Giveaway active').setDescription(lines)] });
            }

            const id = interaction.options.getInteger('id', true);
            if (sub === 'end') {
                const winners = await endGiveaway(interaction.client, id);
                return interaction.editReply(`Da ket thuc giveaway #${id}. Winner: ${winners.length ? winners.map(w => `<@${w}>`).join(', ') : 'khong co'}.`);
            }
            if (sub === 'reroll') {
                const winners = await endGiveaway(interaction.client, id, true);
                return interaction.editReply(`Da reroll giveaway #${id}. Winner moi: ${winners.length ? winners.map(w => `<@${w}>`).join(', ') : 'khong co'}.`);
            }
            await cancelGiveaway(interaction.client, id);
            return interaction.editReply(`Da huy giveaway #${id} va hoan phi tham gia neu co.`);
        } catch (error: any) {
            console.error(error);
            return interaction.editReply(error?.message || 'Da co loi khi xu ly giveaway.');
        }
    }
};
