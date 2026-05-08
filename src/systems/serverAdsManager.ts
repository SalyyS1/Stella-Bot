import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, TextChannel, User } from 'discord.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { status as directMinecraftStatus } from 'minecraft-server-util';
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

function normalizeLink(link: string): string {
    const trimmed = link.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^(discord\.gg|discord\.com\/invite)\//i.test(trimmed)) return `https://${trimmed}`;
    return trimmed;
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
        link: normalizeLink(link),
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

interface McStatusApiResponse {
    online: boolean;
    host?: string;
    port?: number;
    ip_address?: string;
    version?: { name_clean?: string; name_raw?: string; name?: string };
    players?: { online?: number; max?: number };
    motd?: { clean?: string; raw?: string };
    icon?: string | null;
}

function cleanMinecraftText(text?: string): string {
    return (text || '').replace(/§[0-9a-fk-or]/gi, '').replace(/\s+/g, ' ').trim();
}

async function fetchMinecraftStatus(address: { host: string; port: number }): Promise<McStatusApiResponse> {
    const target = address.port === 25565 ? address.host : `${address.host}:${address.port}`;
    try {
        const response = await fetch(`https://api.mcstatus.io/v2/status/java/${encodeURIComponent(target)}`);
        if (!response.ok) throw new Error(`mcstatus.io ${response.status}`);
        return await response.json() as McStatusApiResponse;
    } catch {
        const direct = await directMinecraftStatus(address.host, address.port, { timeout: 8000 });
        return {
            online: true,
            host: address.host,
            port: address.port,
            version: { name_clean: direct.version.name },
            players: { online: direct.players.online, max: direct.players.max },
            motd: { clean: direct.motd.clean },
            icon: direct.favicon
        };
    }
}

async function renderMinecraftStatusCard(input: ServerAdInput, result: McStatusApiResponse): Promise<AttachmentBuilder> {
    const W = 1000;
    const H = 180;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#81846b');
    bg.addColorStop(0.5, '#555b48');
    bg.addColorStop(1, '#2f362d');
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

    if (result.icon) {
        try {
            const icon = await loadImage(result.icon);
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
    ctx.fillText(`${result.players?.online ?? 0}/${result.players?.max ?? 0}`, 925, 45);
    ctx.textAlign = 'left';

    [12, 24, 36, 48, 60].forEach((height, index) => {
        ctx.fillStyle = index < 4 ? '#12f247' : '#0abb32';
        ctx.fillRect(940 + index * 9, 52 - height, 6, height);
    });

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 38px Consolas, "Courier New", monospace';
    ctx.fillText(cleanMinecraftText(result.motd?.clean || input.name).slice(0, 34), 175, 96);

    ctx.fillStyle = '#f4e64f';
    ctx.font = '30px Consolas, "Courier New", monospace';
    ctx.fillText(cleanMinecraftText(input.link || input.description || input.ip || '').slice(0, 52), 175, 140);

    ctx.fillStyle = '#d950bd';
    ctx.font = '26px Consolas, "Courier New", monospace';
    ctx.fillText(`[${cleanMinecraftText(result.version?.name_clean || result.version?.name_raw || result.version?.name)}]`, 650, 96);

    return new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'minecraft-status.png' });
}

async function buildServerAdMessage(input: ServerAdInput, user: User): Promise<{ content: string; embeds: EmbedBuilder[]; files: AttachmentBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] }> {
    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
        .setTitle(`Server Ads - ${input.name}`)
        .setDescription(input.description || 'Không có mô tả.')
        .setFooter({ text: 'Stella Studio - Server Ads' })
        .setTimestamp();

    const files: AttachmentBuilder[] = [];
    const content = `<@${user.id}>`;
    const components = [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setLabel('Go to Server')
                .setStyle(ButtonStyle.Link)
                .setURL(normalizeLink(input.link))
                .setEmoji(config.ui.emojis.greenArrow)
        )
    ];

    if (!input.ip) return { content, embeds: [embed], files, components };

    const address = parseMinecraftAddress(input.ip);
    if (!address) {
        embed.addFields({ name: `${config.ui.emojis.redArrow} Minecraft Server`, value: `IP không hợp lệ: \`${input.ip}\`` });
        return { content, embeds: [embed], files, components };
    }

    try {
        const result = await fetchMinecraftStatus(address);
        if (!result.online) throw new Error('Server offline');
        files.push(await renderMinecraftStatusCard(input, result));
        embed
            .addFields({
                name: `${config.ui.emojis.starJump} Minecraft Server Online`,
                value: `**IP:** \`${input.ip}\`\n**Players:** ${result.players?.online ?? 0}/${result.players?.max ?? 0}`,
                inline: false
            })
            .setImage('attachment://minecraft-status.png');
    } catch (error) {
        embed.addFields({
            name: `${config.ui.emojis.redArrow} Minecraft Server`,
            value: `Không lấy được trạng thái hiện tại cho \`${input.ip}\`. Kiểm tra lại IP/port hoặc thử lại sau.`,
            inline: false
        });
        await sendAdminLog(user.client, {
            title: 'Minecraft status failed',
            color: '#e74c3c',
            fields: [
                { name: 'IP', value: input.ip, inline: true },
                { name: 'User', value: `<@${user.id}>`, inline: true },
                { name: 'Error', value: String(error).slice(0, 1000) }
            ]
        });
    }

    return { content, embeds: [embed], files, components };
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
            `Dùng panel hoặc gửi đúng format bên dưới. Kênh này sẽ được Stella tự reset mỗi tháng 1 lần. Bài sai format sẽ bị xoá để kênh gọn hơn.\n\n` +
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
