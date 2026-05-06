import { AttachmentBuilder, EmbedBuilder, TextChannel, User } from 'discord.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { status } from 'minecraft-server-util';
import type { JavaStatusResponse } from 'minecraft-server-util';
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

export function isValidServerAdInput(input: ServerAdInput): boolean {
    if (!input.name.trim() || !input.link.trim()) return false;
    return /^https?:\/\/\S+/i.test(input.link) || /(discord\.gg|discord\.com\/invite)\//i.test(input.link);
}

export function parseServerAd(text: string): ServerAdInput | null {
    const name = getPart(text, 'NAME');
    const description = getPart(text, 'Description');
    const link = getPart(text, 'Link');
    const ip = getPart(text, 'IP');

    if (!isValidServerAdInput({ name, description, link, ip })) return null;

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

function cleanMinecraftText(text: string): string {
    return text.replace(/§[0-9a-fk-or]/gi, '').replace(/\s+/g, ' ').trim();
}

async function renderMinecraftStatusCard(input: ServerAdInput, result: JavaStatusResponse): Promise<AttachmentBuilder> {
    const W = 1000;
    const H = 180;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#777b64');
    bg.addColorStop(1, '#3b4234');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    for (let x = 0; x < W; x += 10) {
        for (let y = 0; y < H; y += 10) {
            const alpha = ((x * 17 + y * 11) % 30) / 240;
            ctx.fillStyle = `rgba(0,0,0,${alpha})`;
            ctx.fillRect(x, y, 10, 10);
        }
    }

    const iconX = 24;
    const iconY = 30;
    const iconSize = 120;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(iconX, iconY, iconSize, iconSize);

    if (result.favicon) {
        try {
            const icon = await loadImage(result.favicon);
            ctx.drawImage(icon, iconX, iconY, iconSize, iconSize);
        } catch {
            ctx.fillStyle = '#2d2d2d';
            ctx.fillRect(iconX, iconY, iconSize, iconSize);
        }
    }

    ctx.fillStyle = '#f5f5f5';
    ctx.font = '34px Consolas, "Courier New", monospace';
    ctx.fillText('A Minecraft Server', 175, 45);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#e4e4e4';
    ctx.font = '30px Consolas, "Courier New", monospace';
    ctx.fillText(`${result.players.online}/${result.players.max}`, 925, 45);
    ctx.textAlign = 'left';

    [12, 24, 36, 48, 60].forEach((height, index) => {
        ctx.fillStyle = index < 4 ? '#12f247' : '#0abb32';
        ctx.fillRect(940 + index * 9, 52 - height, 6, height);
    });

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 38px Consolas, "Courier New", monospace';
    ctx.fillText(cleanMinecraftText(result.motd.clean || input.name).slice(0, 34), 175, 96);

    ctx.fillStyle = '#f4e64f';
    ctx.font = '30px Consolas, "Courier New", monospace';
    ctx.fillText(cleanMinecraftText(input.link || input.description || input.ip || '').slice(0, 52), 175, 140);

    ctx.fillStyle = '#d950bd';
    ctx.font = '26px Consolas, "Courier New", monospace';
    ctx.fillText(`[${cleanMinecraftText(result.version.name)}]`, 650, 96);

    return new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'minecraft-status.png' });
}

async function buildServerAdMessage(input: ServerAdInput, user: User): Promise<{ content: string; embeds: EmbedBuilder[]; files: AttachmentBuilder[] }> {
    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
        .setTitle(`Server Ads - ${input.name}`)
        .setDescription(input.description || 'Không có mô tả.')
        .addFields({ name: `${config.ui.emojis.greenArrow} Link tham gia`, value: input.link, inline: false })
        .setFooter({ text: 'Stella Studio - Server Ads' })
        .setTimestamp();

    const files: AttachmentBuilder[] = [];
    const content = `${input.link}\n<@${user.id}>`;

    if (!input.ip) return { content, embeds: [embed], files };

    const address = parseMinecraftAddress(input.ip);
    if (!address) {
        embed.addFields({ name: `${config.ui.emojis.redArrow} Minecraft Server`, value: `IP không hợp lệ: \`${input.ip}\`` });
        return { content, embeds: [embed], files };
    }

    try {
        const result = await status(address.host, address.port, { timeout: 5000 });
        files.push(await renderMinecraftStatusCard(input, result));
        embed
            .addFields({
                name: `${config.ui.emojis.starJump} Minecraft Server Online`,
                value: `**IP:** \`${input.ip}\`\n**Players:** ${result.players.online}/${result.players.max} · **Ping:** ${result.roundTripLatency}ms`,
                inline: false
            })
            .setImage('attachment://minecraft-status.png');
    } catch {
        embed.addFields({
            name: `${config.ui.emojis.redArrow} Minecraft Server`,
            value: `Không lấy được trạng thái hiện tại cho \`${input.ip}\`.`,
            inline: false
        });
    }

    return { content, embeds: [embed], files };
}

export async function publishServerAd(channel: TextChannel, user: User, input: ServerAdInput): Promise<void> {
    const message = await buildServerAdMessage(input, user);
    await channel.send(message);
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
