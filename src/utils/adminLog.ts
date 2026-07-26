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
        if (!channel || !channel.isTextBased()) {
            // Keep a console trace: some events (punishment failures, self-action
            // alerts) have no Discord-native audit entry, so a silent drop here
            // would leave zero record anywhere.
            console.error(`[adminLog] botLog channel unavailable, dropping embed: ${options.title} | ${options.description?.slice(0, 300) ?? ''}`);
            return;
        }

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

        await (channel as TextChannel).send({ embeds: [embed] }).catch(error => {
            console.error(`[adminLog] send failed for "${options.title}": ${error?.message ?? error}`);
        });
    } catch (error) {
        // Logging must never break the main bot flow — but it must leave a trace.
        console.error(`[adminLog] unexpected failure for "${options.title}": ${error instanceof Error ? error.message : error}`);
    }
}

export function messageLink(guildId: string | null | undefined, channelId: string, messageId: string): string {
    return guildId
        ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}`
        : `https://discord.com/channels/@me/${channelId}/${messageId}`;
}
