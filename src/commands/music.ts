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
        .setDescription('Music va playlist ca nhan')
        .addSubcommand(sub =>
            sub.setName('play')
                .setDescription('Them bai vao queue')
                .addStringOption(option => option.setName('query').setDescription('Link hoac tu khoa tim kiem').setRequired(true)))
        .addSubcommand(sub => sub.setName('queue').setDescription('Xem queue'))
        .addSubcommand(sub => sub.setName('now').setDescription('Xem bai dang phat'))
        .addSubcommand(sub => sub.setName('skip').setDescription('Skip bai hien tai'))
        .addSubcommand(sub => sub.setName('stop').setDescription('Dung va xoa queue'))
        .addSubcommand(sub => sub.setName('pause').setDescription('Pause'))
        .addSubcommand(sub => sub.setName('resume').setDescription('Resume'))
        .addSubcommand(sub => sub.setName('loop').setDescription('Bat/tat loop'))
        .addSubcommand(sub => sub.setName('shuffle').setDescription('Tron queue'))
        .addSubcommandGroup(group =>
            group.setName('playlist')
                .setDescription('Playlist ca nhan toi da 20 bai')
                .addSubcommand(sub =>
                    sub.setName('add')
                        .setDescription('Luu bai vao playlist')
                        .addStringOption(option => option.setName('title').setDescription('Ten bai').setRequired(true).setMaxLength(200))
                        .addStringOption(option => option.setName('uri').setDescription('Link/search').setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName('remove')
                        .setDescription('Xoa bai theo vi tri')
                        .addIntegerOption(option => option.setName('position').setDescription('Vi tri trong playlist').setRequired(true).setMinValue(1).setMaxValue(20)))
                .addSubcommand(sub => sub.setName('clear').setDescription('Xoa toan bo playlist'))
                .addSubcommand(sub => sub.setName('play').setDescription('Them playlist vao queue'))
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
                return interaction.editReply(`Da them **${track.title}** vao playlist o vi tri **${track.position}**.`);
            }

            if (sub === 'remove') {
                await removePlaylistTrack(interaction.user.id, interaction.options.getInteger('position', true));
                return interaction.editReply('Da xoa bai khoi playlist.');
            }

            if (sub === 'clear') {
                await clearPlaylist(interaction.user.id);
                return interaction.editReply('Da xoa toan bo playlist.');
            }

            if (sub === 'play') {
                const count = await playPlaylist(interaction.client, interaction.guildId!, interaction.channelId, interaction.member as any, interaction.user.id);
                return interaction.editReply(`Da them **${count}** bai tu playlist vao queue.`);
            }

            const tracks = await getPlaylist(interaction.user.id);
            const lines = tracks.map(track => `**${track.position}.** ${track.title}\n${track.uri}`).join('\n') || 'Playlist dang trong.';
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#5865f2')
                    .setTitle(`Playlist cua ${interaction.user.username}`)
                    .setDescription(lines)
                    .setFooter({ text: `${tracks.length}/20 bai` })]
            });
        } catch (error: any) {
            return interaction.editReply(error?.message || 'Da co loi khi xu ly music.');
        }
    }
};
