import {
    ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle,
    EmbedBuilder, MessageFlags, User
} from 'discord.js';
import { config } from '../../config';
import { getPublishedPortfolio, PORTFOLIO_PAGE_SIZE, type PortfolioPage } from './portfolio-query';

// Hiển thị portfolio và xử lý nút phân trang.
//
// Tách khỏi `portfolio-query.ts`: file đó chỉ biết đọc DB, file này chỉ biết dựng embed.
// Nhờ vậy route HTTP sau này dùng lại truy vấn mà không kéo theo discord.js.
//
// LƯU Ý VỀ TÊN: "portfolio" trong repo này đã có một nghĩa khác — bài tự giới thiệu người
// ta tự gõ rồi đăng vào kênh #portfolio (modal `portfolio_modal`). Lệnh này trả lời câu
// khác: những bài showcase của họ ĐÃ ĐƯỢC CỘNG ĐỒNG DUYỆT. Vì hai thứ dễ lẫn nên embed
// nói rõ, và customId của nút dùng tiền tố `pfolio_` để không đụng vào luồng cũ.

const BUTTON_PREFIX = 'pfolio_';

function threadLink(guildId: string, forumThreadId: string | null): string | null {
    // Bài không có thread thì KHÔNG dựng URL: một link
    // `discord.com/channels/<guild>/null` là link chết, tệ hơn là không có link.
    if (!forumThreadId) return null;
    if (!/^\d{5,25}$/.test(forumThreadId)) return null;
    return `https://discord.com/channels/${guildId}/${forumThreadId}`;
}

export function buildPortfolioView(
    author: User,
    guildId: string,
    data: PortfolioPage
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
    const emojis = config.ui.emojis;
    const embed = new EmbedBuilder()
        .setColor(config.ui.colors.portfolio)
        .setAuthor({
            name: `Tác phẩm của ${author.username}`,
            iconURL: author.displayAvatarURL({ extension: 'png', size: 128 })
        });

    if (data.total === 0) {
        embed.setDescription(
            `${emojis.note} Chưa có bài showcase nào được duyệt.\n\n` +
            `> Đăng tác phẩm ở <#${config.channels.showcase}> — đủ **${config.showcase.threshold}** ` +
            `lượt vote thì bài lên khu showcase chính thức và xuất hiện ở đây.\n` +
            `> Hồ sơ tự giới thiệu là việc khác: đăng ở <#${config.channels.portfolio}>.`
        );
        return { embeds: [embed], components: [] };
    }

    const firstIndex = (data.page - 1) * PORTFOLIO_PAGE_SIZE;
    embed.setDescription(
        `${emojis.star} **${data.total}** bài đã được cộng đồng duyệt.\n` +
        `-# Uy tín và số job xem ở \`/profile\`, bảng giá xem ở \`/freelancer profile\`.`
    );

    data.items.forEach((item, offset) => {
        const link = threadLink(guildId, item.forumThreadId);
        const when = item.publishedAt
            ? `<t:${Math.floor(item.publishedAt.getTime() / 1000)}:D>`
            : 'không rõ ngày';
        embed.addFields({
            // `title` là chữ người dùng gõ. Đặt vào tên field (trần 256 của Discord) và
            // cắt sẵn — không đưa vào URL, không đưa vào setTitle.
            name: `${firstIndex + offset + 1}. ${item.title.slice(0, 200)}`,
            value:
                `> ${emojis.service} \`${item.tagName}\` · ${when}` +
                (link ? `\n> [Xem bài](${link})` : ''),
            inline: false
        });
    });

    embed.setFooter({ text: `Trang ${data.page}/${data.pageCount}` });

    if (data.pageCount <= 1) return { embeds: [embed], components: [] };

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`${BUTTON_PREFIX}${author.id}_${data.page - 1}`)
            .setLabel('Trước')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(data.page <= 1),
        new ButtonBuilder()
            .setCustomId(`${BUTTON_PREFIX}${author.id}_${data.page + 1}`)
            .setLabel('Sau')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(data.page >= data.pageCount)
    );
    return { embeds: [embed], components: [row] };
}

/**
 * Nút Trước/Sau: `pfolio_<authorId>_<page>`.
 *
 * Không tin gì trong customId ngoài hai con số: trang được truy vấn lại từ DB mỗi lần
 * bấm, nên một bài bị chuyển sang `OPTED_OUT` sau khi tin nhắn đã gửi sẽ biến mất ngay ở
 * lần bấm kế tiếp. Ai bấm cũng được — dữ liệu này vốn đã công khai trong forum showcase.
 */
export async function handlePortfolioPageButton(interaction: ButtonInteraction): Promise<void> {
    const rest = interaction.customId.slice(BUTTON_PREFIX.length);
    const separator = rest.lastIndexOf('_');
    const authorId = separator === -1 ? '' : rest.slice(0, separator);
    const page = Number(rest.slice(separator + 1));

    if (!/^\d{5,25}$/.test(authorId) || !Number.isFinite(page)) {
        await interaction.reply({
            content: `${config.ui.emojis.error} Nút này đã hỏng, gõ lại \`/portfolio\` nha.`,
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
    }

    const author = await interaction.client.users.fetch(authorId).catch(() => null);
    if (!author) {
        await interaction.reply({
            content: `${config.ui.emojis.error} Không tìm thấy người này nữa.`,
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
    }

    const data = await getPublishedPortfolio(authorId, { page });
    const view = buildPortfolioView(author, interaction.guildId ?? '', data);
    await interaction.update({ ...view, allowedMentions: { parse: [] } }).catch(() => {});
}

export function isPortfolioPageButton(customId: string): boolean {
    return customId.startsWith(BUTTON_PREFIX);
}
