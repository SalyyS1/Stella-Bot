import { EmbedBuilder, TextChannel, User } from 'discord.js';
import { status } from 'minecraft-server-util';
import { config } from '../config';
import { sendAdminLog } from '../utils/adminLog';

export interface ServerAdInput {
    name: string;
    description?: string;
    link: string;
    ip?: string;
}

export function getPart(text: string, key: string): string {
    const regex = new RegExp(`\\[${key}\\]([\\s\\S]*?)(?=\\[|$)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : '';
}

export function parseServerAd(text: string): ServerAdInput | null {
    const name = getPart(text, 'NAME');
    const description = getPart(text, 'Description');
    const link = getPart(text, 'Link');
    const ip = getPart(text, 'IP');

    if (!name || !link) return null;
    if (!/^https?:\/\/\S+/i.test(link) && !/(discord\.gg|discord\.com\/invite)\//i.test(link)) return null;

    return {
        name: name.slice(0, 100),
        description: description.slice(0, 800),
        link,
        ip: ip.slice(0, 120)
    };
}

function parseMinecraftAddress(ip: string): { host: string; port: number } | null {
    const cleaned = ip.trim().replace(/^minecraft:\/\//i, '');
    if (!cleaned || /\s/.test(cleaned)) return null;
    const [host, portRaw] = cleaned.split(':');
    const port = portRaw ? Number(portRaw) : 25565;
    if (!host || Number.isNaN(port) || port < 1 || port > 65535) return null;
    return { host, port };
}

export async function buildServerAdEmbed(input: ServerAdInput, user: User): Promise<EmbedBuilder> {
    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
        .setTitle(`Server Ads - ${input.name}`)
        .setDescription(input.description || 'Không có mô tả.')
        .addFields(
            { name: `${config.ui.emojis.greenArrow} Link tham gia`, value: input.link, inline: false }
        )
        .setFooter({ text: 'Stella Studio - Server Ads' })
        .setTimestamp();

    if (!input.ip) return embed;

    const address = parseMinecraftAddress(input.ip);
    if (!address) {
        embed.addFields({ name: `${config.ui.emojis.redArrow} Minecraft Server`, value: `IP không hợp lệ: \`${input.ip}\`` });
        return embed;
    }

    try {
        const result = await status(address.host, address.port, { timeout: 5000 });
        embed.addFields({
            name: `${config.ui.emojis.starJump} Minecraft Server`,
            value:
                `**IP:** \`${input.ip}\`\n` +
                `**Version:** ${result.version.name}\n` +
                `**Players:** ${result.players.online}/${result.players.max}\n` +
                `**MOTD:** ${result.motd.clean || 'Không có MOTD'}\n` +
                `**Ping:** ${result.roundTripLatency}ms`,
            inline: false
        });
    } catch {
        embed.addFields({
            name: `${config.ui.emojis.redArrow} Minecraft Server`,
            value: `Không lấy được trạng thái hiện tại cho \`${input.ip}\`.`,
            inline: false
        });
    }

    return embed;
}

export async function publishServerAd(channel: TextChannel, user: User, input: ServerAdInput): Promise<void> {
    const embed = await buildServerAdEmbed(input, user);
    await channel.send({ content: `<@${user.id}>`, embeds: [embed] });
    await sendAdminLog(channel.client, {
        title: 'Server ads posted',
        fields: [
            { name: 'User', value: `<@${user.id}>`, inline: true },
            { name: 'Name', value: input.name, inline: true },
            { name: 'IP', value: input.ip || 'Không có', inline: true }
        ]
    });
}

export function buildServerAdsGuideEmbed(): EmbedBuilder {
    return new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('Hướng dẫn đăng quảng cáo server')
        .setDescription(
            `Dùng panel hoặc gửi đúng format bên dưới. Bài sai format sẽ bị xoá để kênh gọn hơn.\n\n` +
            '```text\n' +
            '[NAME] Tên server\n' +
            '[Description] Mô tả ngắn optional\n' +
            '[Link] Link Discord\n' +
            '[IP] IP Minecraft optional\n' +
            '```'
        )
        .setFooter({ text: 'Stella Studio - Server Ads' })
        .setTimestamp();
}
