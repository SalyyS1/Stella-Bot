import { AutocompleteInteraction, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import {
    autocompleteMusicPlaylistName,
    executeMusicSlash,
    handleMusicPlaylistImport,
    handleMusicPlaylistSlash,
    MAX_VOLUME,
    MIN_VOLUME,
    MUSIC_FILTER_PRESETS
} from '../systems/music';
import { config } from '../config';

const PLAYLIST_LIMITS = config.music.playlist;

/** Option `name` dung o hau het subcommand playlist — autocomplete theo playlist của người gọi. */
const playlistNameOption = (description = 'Tên playlist') => (option: any) => option
    .setName('name')
    .setDescription(description)
    .setRequired(true)
    .setAutocomplete(true);

export default {
    data: new SlashCommandBuilder()
        .setName('music')
        .setDescription('Music và playlist cá nhân')
        .addSubcommand(sub =>
            sub.setName('play')
                .setDescription('Thêm bài vào queue')
                .addStringOption(option => option.setName('query').setDescription('Link hoặc từ khóa tìm kiếm').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('search')
                .setDescription('Tìm bài rồi chọn từ danh sách')
                .addStringOption(option => option.setName('query').setDescription('Tên bài / nghệ sĩ').setRequired(true)))
        .addSubcommand(sub => sub.setName('queue').setDescription('Xem queue'))
        .addSubcommand(sub => sub.setName('now').setDescription('Xem bài đang phát'))
        .addSubcommand(sub => sub.setName('skip').setDescription('Skip bài hiện tại'))
        .addSubcommand(sub => sub.setName('stop').setDescription('Dừng và xóa queue'))
        .addSubcommand(sub => sub.setName('pause').setDescription('Pause'))
        .addSubcommand(sub => sub.setName('resume').setDescription('Resume'))
        .addSubcommand(sub => sub.setName('loop').setDescription('Bật/tắt loop'))
        .addSubcommand(sub => sub.setName('shuffle').setDescription('Trộn queue'))
        .addSubcommand(sub =>
            sub.setName('volume')
                .setDescription(`Đổi âm lượng (${MIN_VOLUME}-${MAX_VOLUME}%)`)
                .addIntegerOption(option => option.setName('value').setDescription('Âm lượng %').setRequired(true).setMinValue(MIN_VOLUME).setMaxValue(MAX_VOLUME)))
        .addSubcommand(sub =>
            sub.setName('filter')
                .setDescription('Áp filter âm thanh')
                .addStringOption(option => option
                    .setName('preset')
                    .setDescription('Chọn preset')
                    .setRequired(true)
                    .addChoices(...MUSIC_FILTER_PRESETS.map(preset => ({ name: preset, value: preset })))))
        .addSubcommand(sub => sub.setName('health').setDescription('Kiểm tra trạng thái cấu hình music/Lavalink'))
        .addSubcommandGroup(group =>
            group.setName('playlist')
                .setDescription(`Playlist cá nhân (tối đa ${PLAYLIST_LIMITS.maxPerUser} playlist, ${PLAYLIST_LIMITS.maxTracks} bài/playlist)`)
                .addSubcommand(sub =>
                    sub.setName('create')
                        .setDescription('Tạo playlist mới')
                        .addStringOption(option => option.setName('name').setDescription('Tên playlist').setRequired(true).setMaxLength(PLAYLIST_LIMITS.nameMaxLength))
                        .addStringOption(option => option.setName('description').setDescription('Mô tả ngắn').setMaxLength(PLAYLIST_LIMITS.descriptionMaxLength))
                        .addStringOption(option => option.setName('cover').setDescription('Link ảnh bìa (https, .png/.jpg/.gif/.webp)')))
                .addSubcommand(sub => sub.setName('list').setDescription('Xem tất cả playlist của bạn'))
                .addSubcommand(sub =>
                    sub.setName('view')
                        .setDescription('Xem chi tiết một playlist')
                        .addStringOption(playlistNameOption()))
                .addSubcommand(sub =>
                    sub.setName('add')
                        .setDescription('Tìm bài và thêm vào playlist')
                        .addStringOption(playlistNameOption())
                        .addStringOption(option => option.setName('query').setDescription('Tên bài hoặc link').setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName('save')
                        .setDescription('Lưu bài đang phát vào playlist')
                        .addStringOption(playlistNameOption()))
                .addSubcommand(sub =>
                    sub.setName('play')
                        .setDescription('Nạp playlist vào queue')
                        .addStringOption(playlistNameOption())
                        .addBooleanOption(option => option.setName('shuffle').setDescription('Trộn thứ tự khi nạp')))
                .addSubcommand(sub =>
                    sub.setName('remove')
                        .setDescription('Xóa một bài khỏi playlist')
                        .addStringOption(playlistNameOption())
                        .addIntegerOption(option => option.setName('position').setDescription('Vị trí bài').setRequired(true).setMinValue(1).setMaxValue(PLAYLIST_LIMITS.maxTracks)))
                .addSubcommand(sub =>
                    sub.setName('move')
                        .setDescription('Đổi vị trí một bài trong playlist')
                        .addStringOption(playlistNameOption())
                        .addIntegerOption(option => option.setName('from').setDescription('Vị trí hiện tại').setRequired(true).setMinValue(1).setMaxValue(PLAYLIST_LIMITS.maxTracks))
                        .addIntegerOption(option => option.setName('to').setDescription('Vị trí mới').setRequired(true).setMinValue(1).setMaxValue(PLAYLIST_LIMITS.maxTracks)))
                .addSubcommand(sub =>
                    sub.setName('cover')
                        .setDescription('Đặt ảnh bìa cho playlist')
                        .addStringOption(playlistNameOption())
                        .addStringOption(option => option.setName('url').setDescription('Link ảnh https').setMaxLength(PLAYLIST_LIMITS.coverUrlMaxLength))
                        .addAttachmentOption(option => option.setName('file').setDescription('Ảnh upload từ máy')))
                .addSubcommand(sub =>
                    sub.setName('share')
                        .setDescription('Bật/tắt chia sẻ playlist và lấy mã share')
                        .addStringOption(playlistNameOption())
                        .addBooleanOption(option => option.setName('public').setDescription('Bật công khai (mặc định bật)')))
                .addSubcommand(sub =>
                    sub.setName('import')
                        .setDescription('Copy playlist của người khác bằng mã share')
                        .addStringOption(option => option.setName('code').setDescription('Mã share').setRequired(true))
                        .addStringOption(option => option.setName('name').setDescription('Tên playlist mới').setMaxLength(PLAYLIST_LIMITS.nameMaxLength)))
                .addSubcommand(sub =>
                    sub.setName('rename')
                        .setDescription('Đổi tên playlist')
                        .addStringOption(playlistNameOption())
                        .addStringOption(option => option.setName('newname').setDescription('Tên mới').setRequired(true).setMaxLength(PLAYLIST_LIMITS.nameMaxLength)))
                .addSubcommand(sub =>
                    sub.setName('delete')
                        .setDescription('Xóa playlist')
                        .addStringOption(playlistNameOption()))),

    async autocomplete(interaction: AutocompleteInteraction) {
        if (interaction.options.getSubcommandGroup(false) !== 'playlist') return interaction.respond([]);
        return autocompleteMusicPlaylistName(interaction);
    },

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();
        const group = interaction.options.getSubcommandGroup(false);

        try {
            if (group !== 'playlist') return await executeMusicSlash(interaction);
            if (interaction.options.getSubcommand() === 'import') return await handleMusicPlaylistImport(interaction);
            return await handleMusicPlaylistSlash(interaction);
        } catch (error: any) {
            return interaction.editReply(error?.message || 'Đã có lỗi khi xử lý music.');
        }
    }
};
