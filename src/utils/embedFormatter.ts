import { EmbedBuilder, User } from 'discord.js';
import { config } from '../config';

export function buildRequestPaidEmbed(user: User, service: string, requestDesc: string, budget: string, other: string): EmbedBuilder {
    const { emojis, colors } = config.ui;
    return new EmbedBuilder()
        .setColor(colors.requestPaid)
        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
        .setTitle('YÊU CẦU TÌM NGƯỜI (PAID)')
        .addFields(
            { name: `${emojis.customer} Khách hàng`, value: `<@${user.id}>`, inline: true },
            { name: `${emojis.budget} Ngân sách`, value: `**${budget}**`, inline: true },
            { name: `${emojis.service} Dịch vụ cần`, value: `\`\`\`\n${service}\n\`\`\``, inline: false },
            { name: `${emojis.note} Chi tiết yêu cầu`, value: `${requestDesc}`, inline: false },
            { name: `${emojis.contact} Thông tin khác`, value: `${other || 'Không có'}`, inline: false }
        )
        .setFooter({ text: 'Trạng thái: Đang mở (Open)' })
        .setTimestamp();
}

export function buildRequestFreeEmbed(user: User, service: string, requestDesc: string, other: string): EmbedBuilder {
    const { emojis, colors } = config.ui;
    return new EmbedBuilder()
        .setColor(colors.requestFree)
        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
        .setTitle('YÊU CẦU GIÚP ĐỠ (FREE)')
        .addFields(
            { name: `${emojis.customer} Khách hàng`, value: `<@${user.id}>`, inline: true },
            { name: `${emojis.service} Dịch vụ cần`, value: `\`\`\`\n${service}\n\`\`\``, inline: true },
            { name: `${emojis.note} Chi tiết yêu cầu`, value: `${requestDesc}`, inline: false },
            { name: `${emojis.contact} Lời nhắn / Liên hệ`, value: `${other || 'Không có'}`, inline: false }
        )
        .setFooter({ text: 'Trạng thái: Đang mở (Open)' })
        .setTimestamp();
}

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
