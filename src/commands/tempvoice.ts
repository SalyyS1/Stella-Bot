import {
    ChannelType,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import { config } from '../config';
import { reconcileTempVoiceChannels } from '../systems/tempvoice/tempvoice-service';
import { createHub, deleteHub, getHub, listHubs, listRooms } from '../systems/tempvoice/tempvoice-store';

export default {
    data: new SlashCommandBuilder()
        .setName('tempvoice')
        .setDescription('Phòng voice tạm — vào một kênh là có phòng riêng (thay VoiceMaster)')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Tạo kênh "vào để mở phòng"')
                .addChannelOption(option =>
                    option.setName('category').setDescription('Category chứa phòng mới').addChannelTypes(ChannelType.GuildCategory))
                .addStringOption(option =>
                    option.setName('hubname').setDescription('Tên kênh hub').setMaxLength(90))
                .addStringOption(option =>
                    option.setName('template').setDescription('Mẫu tên phòng, dùng {user}').setMaxLength(90))
                .addIntegerOption(option =>
                    option.setName('limit').setDescription('Giới hạn người mặc định (0 = không giới hạn)').setMinValue(0).setMaxValue(99)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Gỡ một hub')
                .addChannelOption(option =>
                    option.setName('hub').setDescription('Kênh hub').setRequired(true).addChannelTypes(ChannelType.GuildVoice)))
        .addSubcommand(sub => sub.setName('list').setDescription('Xem hub và phòng đang mở'))
        .addSubcommand(sub => sub.setName('cleanup').setDescription('Dọn ngay các phòng rỗng còn sót'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Manage Channels.`, flags: MessageFlags.Ephemeral });
        }
        if (!interaction.guild) {
            return interaction.reply({ content: `${emojis.error} Lệnh này chỉ dùng trong server.`, flags: MessageFlags.Ephemeral });
        }

        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (sub === 'setup') {
            // Kiểm quyền của BOT trước khi tạo hub: thiếu quyền thì hub vẫn dựng được
            // nhưng mọi lượt vào sau đó đều im lặng không tạo phòng — người dùng chỉ
            // thấy "bot hỏng" mà không ai biết vì sao.
            if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
                return interaction.editReply(
                    `${emojis.error} Stella thiếu quyền **Manage Channels** nên không tạo được phòng. ` +
                    'Cấp quyền rồi chạy lại lệnh này.'
                );
            }

            const category = interaction.options.getChannel('category');
            const hubName = interaction.options.getString('hubname') || '➕ Tạo phòng riêng';
            const template = interaction.options.getString('template') || '🔊 Phòng của {user}';
            const userLimit = interaction.options.getInteger('limit') ?? 0;

            const hubChannel = await interaction.guild.channels.create({
                name: hubName,
                type: ChannelType.GuildVoice,
                parent: category?.id,
                reason: `Hub phòng voice tạm do ${interaction.user.tag} tạo`
            });
            await createHub({
                channelId: hubChannel.id,
                categoryId: category?.id || hubChannel.parentId || null,
                nameTemplate: template,
                userLimit
            });

            return interaction.editReply(
                `${emojis.success} Hub đã sẵn sàng: <#${hubChannel.id}>\n` +
                `Vào kênh đó là bot mở phòng riêng theo mẫu \`${template}\`.\n` +
                `Giới hạn mặc định: ${userLimit ? `${userLimit} người` : 'không giới hạn'} · ` +
                `trần ${config.tempVoice.maxChannels} phòng cùng lúc, mỗi người ${config.tempVoice.maxPerUser} phòng.`
            );
        }

        if (sub === 'remove') {
            const channel = interaction.options.getChannel('hub', true);
            const hub = await getHub(channel.id);
            if (!hub) return interaction.editReply(`${emojis.close} <#${channel.id}> không phải hub.`);
            await deleteHub(channel.id);
            // Cố ý KHÔNG xoá kênh hub: nó có thể đang được dùng làm kênh voice thường
            // sau khi gỡ. Xoá một kênh mà người ta không yêu cầu là việc không lùi được.
            return interaction.editReply(
                `${emojis.success} Đã gỡ hub. Kênh <#${channel.id}> vẫn còn — xoá tay nếu không dùng nữa.`
            );
        }

        if (sub === 'cleanup') {
            const cleaned = await reconcileTempVoiceChannels(interaction.guild);
            return interaction.editReply(`${emojis.success} Đã dọn **${cleaned}** phòng rỗng/mồ côi.`);
        }

        const [hubs, rooms] = await Promise.all([listHubs(), listRooms()]);
        return interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('Phòng voice tạm')
                .addFields(
                    {
                        name: `Hub (${hubs.length})`,
                        value: hubs.map(hub => `<#${hub.channelId}> → \`${hub.nameTemplate}\``).join('\n') || '*chưa có*',
                        inline: false
                    },
                    {
                        name: `Phòng đang mở (${rooms.length}/${config.tempVoice.maxChannels})`,
                        value: rooms.map(room => `<#${room.channelId}> · chủ <@${room.ownerId}>`).join('\n').slice(0, 1000) || '*không có*',
                        inline: false
                    }
                )]
        });
    }
};
