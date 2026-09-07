import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    SlashCommandBuilder
} from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import {
    cleanMinecraftText,
    fetchMinecraftStatus,
    parseMinecraftAddress
} from '../systems/minecraft/minecraft-status';

// /mc — công cụ Minecraft cho cộng đồng nhận làm dịch vụ server.
//
// Hai việc độc lập nhau:
//   status — tra server của KHÁCH đang sống hay chết (không cần quyền gì, ai hỗ trợ cũng dùng được)
//   ign    — khai tên Minecraft của CHÍNH MÌNH để hiện đầu skin trên thẻ hồ sơ
//
// IGN không được xác minh và cố ý không gate quyền lợi nào: cộng đồng này không có server
// Minecraft riêng nên không có bằng chứng sở hữu tên. Khai sai chỉ làm xấu thẻ của chính họ.
export default {
    data: new SlashCommandBuilder()
        .setName('mc')
        .setDescription('Công cụ Minecraft: tra server, khai tên Minecraft')
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('Tra trạng thái một server Minecraft (Java)')
                .addStringOption(option =>
                    option.setName('host')
                        .setDescription('Địa chỉ server, ví dụ mc.example.com hoặc mc.example.com:25566')
                        .setRequired(true)
                        .setMaxLength(200)))
        .addSubcommand(sub =>
            sub.setName('ign')
                .setDescription('Đặt tên Minecraft hiện trên thẻ hồ sơ của bạn')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Tên Minecraft (3–16 ký tự, chữ/số/_). Gõ "clear" để bỏ')
                        .setRequired(true)
                        .setMaxLength(32)))
        .addSubcommand(sub =>
            sub.setName('whois')
                .setDescription('Xem tên Minecraft đã khai của một người')
                .addUserOption(option => option.setName('user').setDescription('Mặc định: chính bạn'))),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        const sub = interaction.options.getSubcommand();

        if (sub === 'status') return runStatus(interaction, emojis);
        await interaction.deferReply();
        if (sub === 'ign') return runIgn(interaction, emojis);
        return runWhois(interaction, emojis);
    }
};

async function runStatus(interaction: ChatInputCommandInteraction, emojis: any): Promise<void> {
    const input = interaction.options.getString('host', true);
    await interaction.deferReply();

    const address = parseMinecraftAddress(input);
    if (!address) {
        await interaction.editReply(
            `${emojis.error} Địa chỉ không hợp lệ: \`${input.slice(0, 100)}\`\n` +
            'Đúng dạng: `mc.example.com` hoặc `mc.example.com:25566` (mặc định cổng 25565).'
        );
        return;
    }

    let result;
    try {
        result = await fetchMinecraftStatus(address);
    } catch (error) {
        // Lỗi ở đây gần như luôn là: host không phân giải được, server tắt hẳn, hoặc
        // mcstatus.io chập chờn. Cả ba đều là thông tin hữu ích cho người hỏi nên nói rõ
        // thay vì "lỗi không xác định".
        await interaction.editReply(
            `${emojis.error} Không tra được \`${address.host}:${address.port}\`.\n` +
            `-# ${error instanceof Error ? error.message.slice(0, 200) : 'Lỗi không rõ'} · ` +
            'Nguyên nhân thường gặp: server tắt, host sai, hoặc cổng bị firewall chặn.'
        );
        return;
    }

    const target = `${address.host}${address.port === 25565 ? '' : `:${address.port}`}`;
    if (!result.online) {
        const embed = new EmbedBuilder()
            .setColor('#e74c3c')
            .setTitle(`❌ ${target} đang OFFLINE`)
            .setDescription('Không có phản hồi từ server này ở cổng trên.')
            .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
        return;
    }

    const version = cleanMinecraftText(
        result.version?.name_clean || result.version?.name_raw || result.version?.name || ''
    ) || 'không rõ';
    const motd = cleanMinecraftText(result.motd?.clean || result.motd?.raw || '');
    const online = result.players?.online ?? 0;
    const max = result.players?.max ?? 0;

    const embed = new EmbedBuilder()
        .setColor('#2ecc71')
        .setTitle(`✅ ${target} đang ONLINE`)
        .addFields(
            { name: 'Người chơi', value: `**${online}** / ${max}`, inline: true },
            { name: 'Phiên bản', value: version.slice(0, 100), inline: true },
            { name: 'IP đã phân giải', value: `\`${result.ip_address || address.host}\``, inline: true }
        )
        .setTimestamp();
    if (motd) {
        embed.addFields({
            name: 'MOTD',
            // MOTD là chữ do chủ server đặt — coi như không tin được, nên bỏ backtick
            // và cắt ngắn trước khi hiện.
            value: `\`\`\`${motd.replace(/`/g, '´').slice(0, 500)}\`\`\``,
            inline: false
        });
    }
    await interaction.editReply({ embeds: [embed] });
}

// Minecraft chỉ cho phép [A-Za-z0-9_] và 3–16 ký tự. Chặn đúng luật này là chặn luôn mọi
// cách nhét link, mention hay khoảng trắng vào chỗ sẽ được vẽ lên ảnh và hiện trong embed.
const IGN_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

async function runIgn(interaction: ChatInputCommandInteraction, emojis: any): Promise<void> {
    const raw = interaction.options.getString('name', true).trim();

    if (raw.toLowerCase() === 'clear') {
        await prisma.user.update({
            where: { id: interaction.user.id },
            data: { minecraftIgn: null }
        }).catch(() => null);
        await interaction.editReply(`${emojis.success} Đã bỏ tên Minecraft khỏi thẻ hồ sơ của bạn.`);
        return;
    }

    if (!IGN_PATTERN.test(raw)) {
        await interaction.editReply(
            `${emojis.error} Tên Minecraft không hợp lệ: chỉ chữ cái, số, \`_\`, dài 3–16 ký tự.\n` +
            `-# Muốn bỏ tên đã khai thì gõ \`clear\`.`
        );
        return;
    }

    await prisma.user.upsert({
        where: { id: interaction.user.id },
        update: { minecraftIgn: raw },
        create: { id: interaction.user.id, minecraftIgn: raw }
    });
    await interaction.editReply(
        `${emojis.success} Đã đặt tên Minecraft: \`${raw}\`\n` +
        `-# Đầu skin sẽ hiện trên thẻ \`/profile\` của bạn. Tên này bạn tự khai, Stella không kiểm tra.`
    );
}

async function runWhois(interaction: ChatInputCommandInteraction, emojis: any): Promise<void> {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const user = await prisma.user.findUnique({
        where: { id: target.id },
        select: { minecraftIgn: true }
    });
    const ign = user?.minecraftIgn;
    if (!ign) {
        const self = target.id === interaction.user.id;
        await interaction.editReply(
            `${emojis.note} ${self ? 'Bạn chưa khai' : `<@${target.id}> chưa khai`} tên Minecraft.\n` +
            `-# ${self ? 'Dùng `/mc ign name:<tên>`' : 'Chỉ chính người đó đặt được bằng `/mc ign`.'}`
        );
        return;
    }
    await interaction.editReply(
        `${emojis.note} Tên Minecraft của <@${target.id}>: \`${ign}\`\n` +
        `-# Tự khai, chưa xác minh. Đầu skin: https://mc-heads.net/avatar/${ign}/64`
    );
}
