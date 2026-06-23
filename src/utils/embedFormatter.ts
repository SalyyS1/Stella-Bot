import { EmbedBuilder, User } from 'discord.js';
import { config } from '../config';

export function buildPortfolioEmbed(user: User, name: string, exp: string, service: string, portfolio: string, contact: string): EmbedBuilder {
    const { emojis, colors } = config.ui;
    return new EmbedBuilder()
        .setColor(colors.portfolio)
        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
        .setTitle('QUẢNG BÁ BẢN THÂN (PORTFOLIO)')
        .addFields(
            { name: `${emojis.customer} Tên / Tuổi`, value: `**${name}**`, inline: true },
            { name: `⏱️ Kinh nghiệm`, value: `**${exp}**`, inline: true },
            { name: `${emojis.service} Dịch vụ cung cấp`, value: `\`\`\`\n${service}\n\`\`\``, inline: false },
            { name: `${emojis.portfolio} Portfolio`, value: `${portfolio}`, inline: false },
            { name: `${emojis.contact} Liên hệ`, value: `${contact}`, inline: false }
        )
        .setFooter({ text: 'Liên hệ trực tiếp qua Inbox hoặc tag.' })
        .setTimestamp();
}
