import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

// Panel điều khiển của chủ phòng voice tạm.
//
// customId mang channelId để biết panel thuộc phòng nào, NHƯNG quyền không đọc từ đó:
// tempvoice-controls.ts luôn tra lại `ownerId` trong DB. customId nằm trong tay client.

export interface PanelState {
    channelId: string;
    ownerId: string;
    locked: boolean;
    hidden: boolean;
    userLimit: number;
}

export function buildPanelPayload(state: PanelState) {
    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🔊 Phòng của bạn')
        .setDescription(
            `Chủ phòng: <@${state.ownerId}>\n\n` +
            `${state.locked ? '🔒 Đang khoá — người khác không vào được' : '🔓 Đang mở'}\n` +
            `${state.hidden ? '🙈 Đang ẩn khỏi danh sách kênh' : '👁️ Đang hiện'}\n` +
            `👥 Giới hạn: ${state.userLimit ? `${state.userLimit} người` : 'không giới hạn'}\n\n` +
            '-# Chỉ chủ phòng bấm được. Phòng tự xoá khi không còn ai.'
        );

    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`tvc_rename_${state.channelId}`).setLabel('Đổi tên').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`tvc_lock_${state.channelId}`)
            .setLabel(state.locked ? 'Mở khoá' : 'Khoá phòng')
            .setEmoji(state.locked ? '🔓' : '🔒')
            .setStyle(state.locked ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`tvc_hide_${state.channelId}`)
            .setLabel(state.hidden ? 'Hiện phòng' : 'Ẩn phòng')
            .setEmoji(state.hidden ? '👁️' : '🙈')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tvc_limit_${state.channelId}`).setLabel('Giới hạn người').setEmoji('👥').setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`tvc_kick_${state.channelId}`).setLabel('Đuổi khỏi phòng').setEmoji('🚪').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`tvc_transfer_${state.channelId}`).setLabel('Nhường chủ').setEmoji('🤝').setStyle(ButtonStyle.Secondary),
        // Nút này cố ý mở cho mọi người trong phòng: chủ rời mà không nhường thì những
        // người còn lại phải tự lấy được quyền, nếu không phòng thành vô chủ tới lúc xoá.
        new ButtonBuilder().setCustomId(`tvc_claim_${state.channelId}`).setLabel('Nhận chủ phòng').setEmoji('👑').setStyle(ButtonStyle.Success)
    );

    return { embeds: [embed], components: [row1, row2] };
}
