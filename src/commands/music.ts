import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import {
    addPlaylistTrack,
    clearPlaylist,
    executeMusicSlash,
    getPlaylist,
    playPlaylist,
    removePlaylistTrack
} from '../systems/musicManager';

export default {
    data: new SlashCommandBuilder()
        .setName('music')
        .setDescription('Music và playlist cá nhân')
        .addSubcommand(sub =>
            sub.setName('play')
                .setDescription('Thêm bài vào queue')
                .addStringOption(option => option.setName('query').setDescription('Link hoặc từ khóa tìm kiếm').setRequired(true)))
        .addSubcommand(sub => sub.setName('queue').setDescription('Xem queue'))
        .addSubcommand(sub => sub.setName('now').setDescription('Xem bài đang phát'))
        .addSubcommand(sub => sub.setName('skip').setDescription('Skip bài hiện tại'))
        .addSubcommand(sub => sub.setName('stop').setDescription('Dừng và xóa queue'))
        .addSubcommand(sub => sub.setName('pause').setDescription('Pause'))
        .addSubcommand(sub => sub.setName('resume').setDescription('Resume'))
        .addSubcommand(sub => sub.setName('loop').setDescription('Bật/tắt loop'))
        .addSubcommand(sub => sub.setName('shuffle').setDescription('Trộn queue'))
        .addSubcommandGroup(group =>
            group.setName('playlist')
                .setDescription('Playlist cá nhân tối đa 20 bài')
                .addSubcommand(sub =>
                    sub.setName('add')
                        .setDescription('Lưu bài vào playlist')
                        .addStringOption(option => option.setName('title').setDescription('Tên bài').setRequired(true).setMaxLength(200))
                        .addStringOption(option => option.setName('uri').setDescription('Link/search').setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName('remove')
                        .setDescription('Xóa bài theo vị trí')
                        .addIntegerOption(option => option.setName('position').setDescription('Vị trí trong playlist').setRequired(true).setMinValue(1).setMaxValue(20)))
                .addSubcommand(sub => sub.setName('clear').setDescription('Xóa toàn bộ playlist'))
                .addSubcommand(sub => sub.setName('play').setDescription('Thêm playlist vào queue'))
                .addSubcommand(sub => sub.setName('view').setDescription('Xem playlist'))),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();
        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand();

        try {
            if (group !== 'playlist') {
                return executeMusicSlash(interaction);
            }

            if (sub === 'add') {
                const track = await addPlaylistTrack(
                    interaction.user.id,
                    interaction.options.getString('title', true),
                    interaction.options.getString('uri', true),
                    'manual'
                );
                return interaction.editReply(`Đã thêm **${track.title}** vào playlist ở vị trí **${track.position}**.`);
            }

            if (sub === 'remove') {
                await removePlaylistTrack(interaction.user.id, interaction.options.getInteger('position', true));
                return interaction.editReply('Đã xóa bài khỏi playlist.');
            }

            if (sub === 'clear') {
                await clearPlaylist(interaction.user.id);
                return interaction.editReply('Đã xóa toàn bộ playlist.');
            }

            if (sub === 'play') {
                const count = await playPlaylist(interaction.client, interaction.guildId!, interaction.channelId, interaction.member as any, interaction.user.id);
                return interaction.editReply(`Đã thêm **${count}** bài từ playlist vào queue.`);
            }

            const tracks = await getPlaylist(interaction.user.id);
            const lines = tracks.map(track => `**${track.position}.** ${track.title}\n${track.uri}`).join('\n') || 'Playlist đang trống.';
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#5865f2')
                    .setTitle(`Playlist của ${interaction.user.username}`)
                    .setDescription(lines)
                    .setFooter({ text: `${tracks.length}/20 bài` })]
            });
        } catch (error: any) {
            return interaction.editReply(error?.message || 'Đã có lỗi khi xử lý music.');
        }
    }
};
