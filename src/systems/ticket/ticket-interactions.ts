import {
    ActionRowBuilder,
    ButtonInteraction,
    GuildMember,
    Interaction,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    TextChannel,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import { config } from '../../config';
import { safeInteractionReply } from '../../utils/interaction-safe-reply';
import { closeTicket, isTicketStaff, openTicket } from './ticket-service';
import { claimTicket, getTicketByChannel } from './ticket-store';

// Nút và modal của ticket.
//
// Ba customId: `ticket_open` (panel), `ticket_claim` / `ticket_close` (trong kênh ticket).
// Không customId nào mang channelId hay ticketId — kênh chứa nút CHÍNH LÀ ticket, nên tra
// theo `interaction.channelId` là nguồn không giả được, khác với một id nhét vào customId.

function topicModal(): ModalBuilder {
    return new ModalBuilder()
        .setCustomId('ticket_openmodal')
        .setTitle('Mở ticket')
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
                .setCustomId('topic')
                .setLabel('Bạn cần gì? (ngắn gọn)')
                .setPlaceholder('vd: khiếu nại timeout, báo cáo thành viên spam...')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(500)
        ));
}

async function handleClaim(interaction: ButtonInteraction): Promise<void> {
    const emojis = config.ui.emojis;
    const member = interaction.member as GuildMember | null;
    if (!member) return;

    if (!await isTicketStaff(member)) {
        await safeInteractionReply(interaction, {
            content: `${emojis.error} Chỉ ban quản trị nhận xử lý được.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const ticket = await getTicketByChannel(interaction.channelId);
    if (!ticket || ticket.closedAt) {
        await safeInteractionReply(interaction, {
            content: `${emojis.error} Kênh này không phải ticket đang mở.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    if (ticket.claimedBy) {
        await safeInteractionReply(interaction, {
            content: `${emojis.close} <@${ticket.claimedBy}> đã nhận xử lý ticket này.`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] }
        });
        return;
    }

    await claimTicket(interaction.channelId, interaction.user.id);
    await safeInteractionReply(interaction, {
        content: `${emojis.success} <@${interaction.user.id}> đã nhận xử lý ticket này.`,
        allowedMentions: { parse: [] }
    });
}

async function handleClose(interaction: ButtonInteraction): Promise<void> {
    const emojis = config.ui.emojis;
    const member = interaction.member as GuildMember | null;
    const ticket = await getTicketByChannel(interaction.channelId);
    if (!member || !ticket || ticket.closedAt) {
        await safeInteractionReply(interaction, {
            content: `${emojis.error} Kênh này không phải ticket đang mở.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Người mở được tự đóng ticket của mình — đó là kênh về việc của họ.
    const allowed = ticket.openerId === interaction.user.id || await isTicketStaff(member);
    if (!allowed) {
        await safeInteractionReply(interaction, {
            content: `${emojis.error} Chỉ người mở hoặc ban quản trị đóng được.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await safeInteractionReply(interaction, { content: `${emojis.note} Đang lưu transcript...`, flags: MessageFlags.Ephemeral });
    const result = await closeTicket(interaction.channel as TextChannel, interaction.user.id, null);
    if (!result.ok) {
        await safeInteractionReply(interaction, { content: `${emojis.error} ${result.error}`, flags: MessageFlags.Ephemeral });
    }
}

async function handleOpenModal(interaction: ModalSubmitInteraction): Promise<void> {
    const emojis = config.ui.emojis;
    const member = interaction.member as GuildMember | null;
    if (!member) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const topic = interaction.fields.getTextInputValue('topic').trim();
    const result = await openTicket(member, topic);

    await interaction.editReply(
        result.ok
            ? `${emojis.success} Đã mở ticket: <#${result.channelId}>`
            : `${emojis.error} ${result.error}`
    );
}

/** Điểm vào từ interactionCreate cho mọi component `ticket_*`. */
export async function handleTicketComponent(interaction: Interaction): Promise<void> {
    try {
        if (interaction.isButton()) {
            if (interaction.customId === 'ticket_open') {
                await interaction.showModal(topicModal()).catch(() => {});
                return;
            }
            if (interaction.customId === 'ticket_claim') return handleClaim(interaction);
            if (interaction.customId === 'ticket_close') return handleClose(interaction);
            return;
        }
        if (interaction.isModalSubmit() && interaction.customId === 'ticket_openmodal') {
            return handleOpenModal(interaction);
        }
    } catch (error: any) {
        console.error('[ticket] component lỗi:', error);
        await safeInteractionReply(interaction, {
            content: `${config.ui.emojis.error} ${error?.message || 'Không xử lý được.'}`,
            flags: MessageFlags.Ephemeral
        });
    }
}
