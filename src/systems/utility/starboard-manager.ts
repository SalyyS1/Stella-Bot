import { Client, EmbedBuilder, Message, MessageReaction, PartialMessageReaction, TextChannel } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';

// Starboard: tin được nhiều người thả sao thì được đăng lại vào kênh lưu niệm.
//
// Kênh đích lưu ở bảng ManagedChannel (bảng key→value có sẵn) để đổi được bằng lệnh,
// không phải sửa config rồi deploy lại. Ngưỡng sao cũng lưu ở đó dưới key riêng: cột
// tên `channelId` nhưng thực chất là một cột chuỗi dùng chung — `skillRoleManager.ts`
// đã dùng nó để lưu role id theo đúng cách này.

const CHANNEL_KEY = 'starboard';
const THRESHOLD_KEY = 'starboard:threshold';

export async function getStarboardConfig(): Promise<{ channelId: string; threshold: number }> {
    const rows = await prisma.managedChannel
        .findMany({ where: { key: { in: [CHANNEL_KEY, THRESHOLD_KEY] } } })
        .catch(() => []);
    const channelId = rows.find(row => row.key === CHANNEL_KEY)?.channelId || config.utility.starboard.channelId;
    const stored = Number.parseInt(rows.find(row => row.key === THRESHOLD_KEY)?.channelId || '', 10);
    return {
        channelId,
        threshold: Number.isInteger(stored) && stored > 0 ? stored : config.utility.starboard.threshold
    };
}

export async function setStarboard(channelId: string, threshold: number): Promise<void> {
    await prisma.managedChannel.upsert({
        where: { key: CHANNEL_KEY },
        update: { channelId },
        create: { key: CHANNEL_KEY, channelId }
    });
    await prisma.managedChannel.upsert({
        where: { key: THRESHOLD_KEY },
        update: { channelId: String(threshold) },
        create: { key: THRESHOLD_KEY, channelId: String(threshold) }
    });
}

export async function disableStarboard(): Promise<void> {
    await prisma.managedChannel.deleteMany({ where: { key: CHANNEL_KEY } }).catch(() => {});
}

/**
 * Đếm sao HỢP LỆ: bỏ bot và (mặc định) bỏ chính tác giả.
 *
 * Không dùng thẳng `reaction.count` vì con số đó tính cả bot và cả lượt tác giả tự thả
 * cho mình — mà "tự thả sao cho bài của mình để lên bảng" đúng là cách người ta phá
 * starboard đầu tiên.
 */
async function countValidStars(reaction: MessageReaction, authorId: string): Promise<number> {
    const users = await reaction.users.fetch().catch(() => null);
    if (!users) return 0;
    return users.filter(user => !user.bot && (config.utility.starboard.allowSelfStar || user.id !== authorId)).size;
}

function buildStarEmbed(message: Message, stars: number): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setColor('#f1c40f')
        .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL({ size: 128 }) })
        .setDescription(
            (message.content?.slice(0, 3500) || '*(không có chữ)*') +
            `\n\n[Tới tin gốc](${message.url}) · <#${message.channelId}>`
        )
        .setFooter({ text: `${config.utility.starboard.emoji} ${stars}` })
        .setTimestamp(message.createdAt);

    const image = message.attachments.find(attachment => attachment.contentType?.startsWith('image/'));
    if (image) embed.setImage(image.url);
    return embed;
}

export async function handleStarReaction(
    reaction: MessageReaction | PartialMessageReaction,
    client: Client
): Promise<void> {
    if (!config.utility.starboard.enabled) return;
    const emoji = reaction.emoji.name;
    if (emoji !== config.utility.starboard.emoji) return;

    const { channelId: boardId, threshold } = await getStarboardConfig();
    if (!boardId) return;

    const full = reaction.partial ? await reaction.fetch().catch(() => null) : (reaction as MessageReaction);
    if (!full) return;
    const message = full.message.partial ? await full.message.fetch().catch(() => null) : (full.message as Message);
    if (!message || !message.guild) return;
    // Không starboard chính kênh starboard: nếu không thì một bài lên bảng rồi được thả
    // sao tiếp sẽ tự nhân bản vô hạn.
    if (message.channelId === boardId) return;
    if (message.author.bot) return;

    const stars = await countValidStars(full, message.author.id);
    const existing = await prisma.starboardPost.findUnique({ where: { sourceMessageId: message.id } }).catch(() => null);
    const board = await client.channels.fetch(boardId).catch(() => null);
    if (!board?.isTextBased()) return;

    if (stars < threshold) {
        // Rút sao xuống dưới ngưỡng thì bài rời bảng. Giữ lại sẽ khiến "bảng vàng" đầy
        // những bài mà cộng đồng đã rút lại phiếu.
        if (existing) {
            await (board as TextChannel).messages.fetch(existing.starboardMessageId)
                .then(post => post.delete())
                .catch(() => {});
            await prisma.starboardPost.delete({ where: { sourceMessageId: message.id } }).catch(() => {});
        }
        return;
    }

    const embed = buildStarEmbed(message, stars);
    if (existing) {
        const edited = await (board as TextChannel).messages.fetch(existing.starboardMessageId)
            .then(post => post.edit({ embeds: [embed] }))
            .catch(() => null);
        if (edited) {
            await prisma.starboardPost.update({ where: { sourceMessageId: message.id }, data: { stars } }).catch(() => {});
            return;
        }
        // Tin trên bảng bị xoá tay → dọn row rồi đăng lại bên dưới.
        await prisma.starboardPost.delete({ where: { sourceMessageId: message.id } }).catch(() => {});
    }

    const sent = await (board as TextChannel)
        // Không ping tác giả: đăng lại tin của người khác kèm ping biến starboard thành
        // máy quấy rối đúng những người viết hay nhất.
        .send({ embeds: [embed], allowedMentions: { parse: [] } })
        .catch(() => null);
    if (!sent) return;

    await prisma.starboardPost.upsert({
        where: { sourceMessageId: message.id },
        update: { starboardMessageId: sent.id, stars },
        create: {
            sourceMessageId: message.id,
            starboardMessageId: sent.id,
            sourceChannelId: message.channelId,
            authorId: message.author.id,
            stars
        }
    }).catch(() => {});
}

/** Tin gốc bị xoá → dọn bài trên bảng để không còn trỏ tới một tin không tồn tại. */
export async function removeStarboardPost(client: Client, sourceMessageId: string): Promise<void> {
    const existing = await prisma.starboardPost.findUnique({ where: { sourceMessageId } }).catch(() => null);
    if (!existing) return;

    const { channelId: boardId } = await getStarboardConfig();
    const board = boardId ? await client.channels.fetch(boardId).catch(() => null) : null;
    if (board?.isTextBased()) {
        await (board as TextChannel).messages.fetch(existing.starboardMessageId)
            .then(post => post.delete())
            .catch(() => {});
    }
    await prisma.starboardPost.delete({ where: { sourceMessageId } }).catch(() => {});
}
