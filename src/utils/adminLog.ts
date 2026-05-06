import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { config } from '../config';

interface AdminLogOptions {
    title: string;
    description?: string;
    color?: number | string;
    fields?: { name: string; value: string; inline?: boolean }[];
}

export async function sendAdminLog(client: Client, options: AdminLogOptions): Promise<void> {
    try {
        const channel = await client.channels.fetch(config.channels.botLog).catch(() => null);
        if (!channel || !channel.isTextBased()) return;

        const embed = new EmbedBuilder()
            .setColor((options.color || '#5865F2') as any)
            .setTitle(options.title)
            .setTimestamp();

        if (options.description) embed.setDescription(options.description.slice(0, 4000));
        if (options.fields?.length) {
            embed.addFields(options.fields.map(field => ({
                ...field,
                value: field.value.slice(0, 1024)
            })));
        }

        await (channel as TextChannel).send({ embeds: [embed] }).catch(() => {});
    } catch {
        // Logging must never break the main bot flow.
    }
}

export function messageLink(guildId: string | null | undefined, channelId: string, messageId: string): string {
    return guildId
        ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}`
        : `https://discord.com/channels/@me/${channelId}/${messageId}`;
}
