import {
    ActionRowBuilder,
    ButtonInteraction,
    ChannelType,
    Interaction,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder,
    UserSelectMenuInteraction,
    VoiceBasedChannel
} from 'discord.js';
import { config } from '../../config';
import { safeInteractionReply } from '../../utils/interaction-safe-reply';
import { markInternalAntiRaidAction } from '../antiRaidManager';
import { buildPanelPayload } from './tempvoice-panel';
import { sanitizeRoomName } from './tempvoice-service';
import { getRoom, updateRoom } from './tempvoice-store';

// Xử lý panel phòng voice tạm.
//
// Hai chốt an toàn lặp lại ở mọi nhánh:
//   1. `ownerId` đọc từ DB, không đọc từ customId — customId nằm trong tay client.
//   2. Chủ phòng chỉ sửa được ĐÚNG phòng của họ, và chỉ ba thứ: khoá (Connect), ẩn
//      (ViewChannel), giới hạn người. Không mở đường sửa quyền tuỳ ý.

interface RoomContext {
    channel: VoiceBasedChannel;
    ownerId: string;
    locked: boolean;
    hidden: boolean;
}

async function loadRoom(
    interaction: ButtonInteraction | ModalSubmitInteraction | UserSelectMenuInteraction,
    channelId: string,
    requireOwner = true
): Promise<RoomContext | null> {
    const emojis = config.ui.emojis;
    const room = await getRoom(channelId);
    const channel = interaction.guild?.channels.cache.get(channelId);

    if (!room || !channel || channel.type !== ChannelType.GuildVoice) {
        await safeInteractionReply(interaction, {
            content: `${emojis.error} Phòng này không còn nữa.`,
            flags: MessageFlags.Ephemeral
        });
        return null;
    }
    if (requireOwner && room.ownerId !== interaction.user.id) {
        await safeInteractionReply(interaction, {
            content: `${emojis.error} Chỉ chủ phòng (<@${room.ownerId}>) dùng được nút này.`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] }
        });
        return null;
    }

    return { channel: channel as VoiceBasedChannel, ownerId: room.ownerId, locked: room.locked, hidden: room.hidden };
}

/** Vẽ lại panel sau khi trạng thái đổi, để nút hiện đúng "Khoá" hay "Mở khoá". */
async function refreshPanel(interaction: ButtonInteraction | ModalSubmitInteraction, context: RoomContext): Promise<void> {
    const payload = buildPanelPayload({
        channelId: context.channel.id,
        ownerId: context.ownerId,
        locked: context.locked,
        hidden: context.hidden,
        userLimit: context.channel.userLimit ?? 0
    });
    await interaction.message?.edit(payload).catch(() => {});
}

function memberSelectRow(customId: string, placeholder: string) {
    return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1)
    );
}

async function handleButton(interaction: ButtonInteraction, action: string, channelId: string): Promise<void> {
    const emojis = config.ui.emojis;

    if (action === 'rename' || action === 'limit') {
        const context = await loadRoom(interaction, channelId);
        if (!context) return;
        const modal = new ModalBuilder()
            .setCustomId(`tvc_${action}modal_${channelId}`)
            .setTitle(action === 'rename' ? 'Đổi tên phòng' : 'Giới hạn số người');
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
                .setCustomId('value')
                .setLabel(action === 'rename' ? 'Tên mới' : 'Số người (0 = không giới hạn)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(action === 'rename' ? 90 : 2)
        ));
        await interaction.showModal(modal).catch(() => {});
        return;
    }

    if (action === 'kick' || action === 'transfer') {
        const context = await loadRoom(interaction, channelId);
        if (!context) return;
        await safeInteractionReply(interaction, {
            content: action === 'kick' ? 'Chọn người cần đuổi khỏi phòng:' : 'Chọn người sẽ làm chủ phòng:',
            components: [memberSelectRow(`tvc_${action}sel_${channelId}`, 'Chọn thành viên...')],
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (action === 'claim') {
        const room = await getRoom(channelId);
        const channel = interaction.guild?.channels.cache.get(channelId) as VoiceBasedChannel | undefined;
        if (!room || !channel) {
            await safeInteractionReply(interaction, { content: `${emojis.error} Phòng này không còn nữa.`, flags: MessageFlags.Ephemeral });
            return;
        }
        // Chỉ cho nhận chủ khi chủ cũ ĐÃ RỜI. Nếu không thì bất kỳ ai vào phòng cũng
        // cướp được quyền của người đang ngồi trong đó.
        if (channel.members.has(room.ownerId)) {
            await safeInteractionReply(interaction, {
                content: `${emojis.error} Chủ phòng vẫn đang ở đây.`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        if (!channel.members.has(interaction.user.id)) {
            await safeInteractionReply(interaction, {
                content: `${emojis.error} Bạn phải đang ở trong phòng mới nhận được.`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        await updateRoom(channelId, { ownerId: interaction.user.id });
        await refreshPanel(interaction, { channel, ownerId: interaction.user.id, locked: room.locked, hidden: room.hidden });
        await safeInteractionReply(interaction, { content: `${emojis.success} Bạn là chủ phòng này rồi.`, flags: MessageFlags.Ephemeral });
        return;
    }

    if (action === 'lock' || action === 'hide') {
        const context = await loadRoom(interaction, channelId);
        if (!context) return;
        const guildId = interaction.guild!.id;
        const next = action === 'lock' ? !context.locked : !context.hidden;

        const applied = await context.channel.permissionOverwrites
            .edit(guildId, action === 'lock' ? { Connect: next ? false : null } : { ViewChannel: next ? false : null })
            .then(() => true)
            .catch(() => false);
        if (!applied) {
            await safeInteractionReply(interaction, {
                content: `${emojis.error} Stella không sửa được quyền kênh này.`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        await updateRoom(channelId, action === 'lock' ? { locked: next } : { hidden: next });
        const updated = { ...context, [action === 'lock' ? 'locked' : 'hidden']: next } as RoomContext;
        await refreshPanel(interaction, updated);
        await safeInteractionReply(interaction, {
            content: action === 'lock'
                ? `${emojis.success} Phòng đã ${next ? 'khoá' : 'mở'}.`
                : `${emojis.success} Phòng đã ${next ? 'ẩn' : 'hiện'}.`,
            flags: MessageFlags.Ephemeral
        });
    }
}

async function handleModal(interaction: ModalSubmitInteraction, action: string, channelId: string): Promise<void> {
    const emojis = config.ui.emojis;
    const context = await loadRoom(interaction, channelId);
    if (!context) return;
    const raw = interaction.fields.getTextInputValue('value');

    if (action === 'renamemodal') {
        const name = sanitizeRoomName(raw);
        // Không xin phép thì guardChannelUpdate đổi ngược tên về cũ ngay sau đó.
        markInternalAntiRaidAction('channelUpdate', context.channel.id);
        const renamed = await context.channel.setName(name).then(() => true).catch(() => false);
        await safeInteractionReply(interaction, {
            content: renamed
                ? `${emojis.success} Đã đổi tên thành **${name}**.`
                // Discord chỉ cho đổi tên kênh 2 lần / 10 phút, và lỗi trả về không nói rõ.
                : `${emojis.error} Không đổi được tên. Discord chỉ cho đổi tên kênh 2 lần mỗi 10 phút — thử lại sau nhé.`,
            flags: MessageFlags.Ephemeral
        });
        await refreshPanel(interaction, context);
        return;
    }

    const limit = Number.parseInt(raw.trim(), 10);
    if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
        await safeInteractionReply(interaction, {
            content: `${emojis.error} Nhập số từ 0 đến 99 (0 = không giới hạn).`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    await context.channel.setUserLimit(limit).catch(() => {});
    await refreshPanel(interaction, context);
    await safeInteractionReply(interaction, {
        content: `${emojis.success} Giới hạn phòng: ${limit ? `${limit} người` : 'không giới hạn'}.`,
        flags: MessageFlags.Ephemeral
    });
}

async function handleUserSelect(interaction: UserSelectMenuInteraction, action: string, channelId: string): Promise<void> {
    const emojis = config.ui.emojis;
    const context = await loadRoom(interaction, channelId);
    if (!context) return;

    const targetId = interaction.values[0];
    if (targetId === interaction.user.id) {
        await safeInteractionReply(interaction, { content: `${emojis.error} Không chọn chính mình được.`, flags: MessageFlags.Ephemeral });
        return;
    }
    const target = await interaction.guild!.members.fetch(targetId).catch(() => null);
    if (!target || !context.channel.members.has(targetId)) {
        await safeInteractionReply(interaction, {
            content: `${emojis.error} Người này không ở trong phòng.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (action === 'kicksel') {
        // Không cho đuổi staff: nếu không thì một member tạo phòng rồi đuổi mod ra khỏi
        // chính phòng mà mod đang vào để xử lý.
        if (target.permissions.has(PermissionFlagsBits.ManageChannels)) {
            await safeInteractionReply(interaction, {
                content: `${emojis.error} Không đuổi được thành viên ban quản trị.`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        await target.voice.disconnect('Bị chủ phòng voice tạm đuổi').catch(() => {});
        await safeInteractionReply(interaction, {
            content: `${emojis.success} Đã đuổi ${target} khỏi phòng.`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] }
        });
        return;
    }

    if (target.user.bot) {
        await safeInteractionReply(interaction, { content: `${emojis.error} Không nhường phòng cho bot.`, flags: MessageFlags.Ephemeral });
        return;
    }
    await updateRoom(channelId, { ownerId: targetId });
    await safeInteractionReply(interaction, {
        content: `${emojis.success} ${target} là chủ phòng mới.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
    });
}

/** Điểm vào duy nhất từ interactionCreate: customId dạng `tvc_<action>_<channelId>`. */
export async function handleTempVoiceComponent(interaction: Interaction): Promise<void> {
    if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isUserSelectMenu()) return;
    const [, action, channelId] = interaction.customId.split('_');
    if (!action || !channelId || !interaction.guild) return;

    try {
        if (interaction.isButton()) await handleButton(interaction, action, channelId);
        else if (interaction.isModalSubmit()) await handleModal(interaction, action, channelId);
        else await handleUserSelect(interaction, action, channelId);
    } catch (error: any) {
        console.error('[tempvoice] panel lỗi:', error);
        await safeInteractionReply(interaction, {
            content: `${config.ui.emojis.error} ${error?.message || 'Không thực hiện được.'}`,
            flags: MessageFlags.Ephemeral
        });
    }
}
