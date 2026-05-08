import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client,
    EmbedBuilder,
    TextChannel
} from 'discord.js';
import { messageLink, sendAdminLog } from '../utils/adminLog';

export type PendingAnnouncement = {
    id: string;
    creatorId: string;
    channelId: string;
    roleId?: string | null;
    title: string;
    description: string;
    color?: string | null;
    emoji?: string | null;
    imageUrl?: string | null;
    thumbnailUrl?: string | null;
    footer?: string | null;
    buttonLabel?: string | null;
    buttonUrl?: string | null;
    createdAt: number;
};

const pending = new Map<string, PendingAnnouncement>();
const TTL_MS = 10 * 60_000;

export function createPendingAnnouncement(data: Omit<PendingAnnouncement, 'id' | 'createdAt'>) {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const announcement = { ...data, id, createdAt: Date.now() };
    pending.set(id, announcement);
    setTimeout(() => {
        const current = pending.get(id);
        if (current && Date.now() - current.createdAt >= TTL_MS) pending.delete(id);
    }, TTL_MS + 1000);
    return announcement;
}

export function takePendingAnnouncement(id: string) {
    const announcement = pending.get(id);
    if (!announcement) return null;
    pending.delete(id);
    return announcement;
}

export function getPendingAnnouncement(id: string) {
    return pending.get(id) || null;
}

export function buildAnnouncementEmbed(data: PendingAnnouncement) {
    const embed = new EmbedBuilder()
        .setColor((data.color || '#ff66cc') as any)
        .setTitle(`${data.emoji ? `${data.emoji} ` : ''}${data.title}`)
        .setDescription(data.description)
        .setTimestamp();

    if (data.imageUrl) embed.setImage(data.imageUrl);
    if (data.thumbnailUrl) embed.setThumbnail(data.thumbnailUrl);
    if (data.footer) embed.setFooter({ text: data.footer });
    return embed;
}

export function previewButtons(id: string) {
    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`announce_send_${id}`).setLabel('Gui thong bao').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`announce_cancel_${id}`).setLabel('Huy').setStyle(ButtonStyle.Secondary)
        )
    ];
}

export function announcementComponents(data: PendingAnnouncement) {
    if (!data.buttonLabel || !data.buttonUrl) return [];
    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setLabel(data.buttonLabel).setURL(data.buttonUrl).setStyle(ButtonStyle.Link)
        )
    ];
}

export async function sendAnnouncement(client: Client, data: PendingAnnouncement) {
    const channel = await client.channels.fetch(data.channelId).catch(() => null) as TextChannel | null;
    if (!channel?.isTextBased()) throw new Error('Target channel not found.');

    const content = data.roleId ? `<@&${data.roleId}>` : '';
    const message = await channel.send({
        content,
        embeds: [buildAnnouncementEmbed(data)],
        components: announcementComponents(data),
        allowedMentions: { roles: data.roleId ? [data.roleId] : [], users: [], parse: [] }
    });

    await sendAdminLog(client, {
        title: 'Announcement sent',
        color: '#ff66cc',
        fields: [
            { name: 'Creator', value: `<@${data.creatorId}>`, inline: true },
            { name: 'Channel', value: `<#${data.channelId}>`, inline: true },
            { name: 'Ping role', value: data.roleId ? `<@&${data.roleId}>` : 'None', inline: true },
            { name: 'Message', value: messageLink(message.guildId, message.channelId, message.id) }
        ]
    }).catch(() => {});

    return message;
}
