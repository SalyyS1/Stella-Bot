import { Events, Message, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from '../config';
import prisma from '../lib/prisma';
import { buildRequestPaidEmbed, buildRequestFreeEmbed, buildPortfolioEmbed } from '../utils/embedFormatter';
import { processMessageXp } from '../systems/xpManager';
import { createShowcasePost, isAllowedShowcaseMessage } from '../systems/showcaseManager';
import { parseServerAd, publishServerAd } from '../systems/serverAdsManager';

const getPart = (text: string, kw: string) => {
    // Regex lấy nội dung đằng sau [Keyword] cho tới gặp dấu [ tiếp theo hoặc hết chuỗi
    const regex = new RegExp(`\\[${kw}\\]([\\s\\S]*?)(?=\\[|$)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : '';
};

export default {
    name: Events.MessageCreate,
    once: false,
    async execute(message: Message) {
        // Bỏ qua tin nhắn của bot
        if (message.author.bot) return;

        // === XP TRACKING (chạy ngầm, không block) ===
        if (message.guild && message.member) {
            processMessageXp(message.author.id, message.content, message.guild, message.member).then(result => {
                if (result?.leveledUp) {
                    const emojis = config.ui.emojis;
                    const logChannel = message.client.channels.cache.get(config.channels.botLog) as any;
                    if (logChannel) {
                        const embed = new EmbedBuilder()
                            .setColor('#f1c40f')
                            .setDescription(`${emojis.success} **${message.author.username}** vừa lên **Level ${result.newLevel}**! 🎉`)
                            .setFooter({ text: 'Stella Studio · Level System' });
                        logChannel.send({ embeds: [embed] }).catch(() => {});
                    }
                }
            }).catch(() => {});
        }

        // Xử lý kênh #share và #showcase
        if (message.channelId === config.channels.share || message.channelId === config.channels.showcase) {
            const hasAttachment = message.attachments.size > 0;
            // Cho phép bất kỳ link nào (http/https) cho kênh share
            const hasAnyLink = /(https?:\/\/[^\s]+)/i.test(message.content);
            const isTenor = /tenor\.com/i.test(message.content);

            if (message.channelId === config.channels.showcase) {
                // Kênh Showcase cho phép link, ảnh, video, GIF/media.
                if (!isAllowedShowcaseMessage(message)) {
                    await message.delete().catch(() => {});
                    const embed = new EmbedBuilder()
                        .setColor('Red')
                        .setDescription('❌ **Sai định dạng!**\n\nKênh `#showcase` cần có ảnh, video, GIF hoặc link showcase.');
                    const warningMsg = await (message.channel as any).send({ content: `<@${message.author.id}>`, embeds: [embed] });
                    setTimeout(() => warningMsg.delete().catch(() => {}), 10000);
                    return;
                }
            } else {
                // Kênh Share cho phép link hoặc file hoặc url bất kỳ
                if (!hasAttachment && !hasAnyLink && !isTenor) {
                    await message.delete().catch(() => {});
                    const embed = new EmbedBuilder()
                        .setColor('Red')
                        .setDescription('❌ **Invalid Format! / Sai định dạng!**\n\n📌 Kênh `#share` yêu cầu bắt buộc phải đính kèm hình ảnh/video hoặc link media trực tiếp.');
                    const warningMsg = await (message.channel as any).send({ content: `<@${message.author.id}>`, embeds: [embed] });
                    setTimeout(() => warningMsg.delete().catch(() => {}), 10000);
                    return;
                }
            }

            // Auto-react with upvote/downvote emojis (dùng name:id format)
            try {
                const upMatch = config.ui.emojis.upvote.match(/<(?:a)?:(\w+):(\d+)>/);
                const downMatch = config.ui.emojis.downvote.match(/<(?:a)?:(\w+):(\d+)>/);
                if (upMatch) await message.react(`${upMatch[1]}:${upMatch[2]}`).catch(e => console.error('Upvote react fail:', e));
                if (downMatch) await message.react(`${downMatch[1]}:${downMatch[2]}`).catch(e => console.error('Downvote react fail:', e));
            } catch (error) {
                console.error('Failed to add vote reactions:', error);
            }

            try {
                const threadName = message.content.length > 20 
                    ? message.content.substring(0, 20) + '...' 
                    : `Bài của ${message.author.username}`;
                
                await message.startThread({
                    name: threadName,
                    autoArchiveDuration: 1440,
                });
            } catch (error) {
                console.error('Failed to create thread:', error);
            }

            if (message.channelId === config.channels.showcase) {
                await createShowcasePost(message).catch(error => console.error('Failed to create showcase post:', error));
            }
            return;
        }

        // Xử lý Auto-Format Form
        const content = message.content;

        if (message.channelId === config.channels.serverAds) {
            const parsed = parseServerAd(content);
            if (!parsed) {
                await message.delete().catch(() => {});
                const embed = new EmbedBuilder()
                    .setColor('Red')
                    .setDescription('❌ Bài quảng cáo cần có `[NAME]` và `[Link]`. `[Description]`, `[IP]` là optional.');
                const warningMsg = await (message.channel as any).send({ content: `<@${message.author.id}>`, embeds: [embed] });
                setTimeout(() => warningMsg.delete().catch(() => {}), 10000);
            } else {
                await message.delete().catch(() => {});
                await publishServerAd(message.channel as any, message.author, parsed);
            }
        }
        else if (message.channelId === config.channels.requestPaid) {
            const requiredKeywords = ['[Service]', '[Request]', '[Budget]'];
            const isValid = requiredKeywords.every(kw => content.includes(kw));

            if (!isValid) {
                await message.delete().catch(() => {});
            } else {
                // Transform to Embed
                await message.delete().catch(() => {});
                const service = getPart(content, 'Service');
                const requestDesc = getPart(content, 'Request');
                const budget = getPart(content, 'Budget');
                const other = getPart(content, 'Other');

                const embed = buildRequestPaidEmbed(message.author, service, requestDesc, budget, other);
                const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId(`close_${message.author.id}`).setLabel('Hoàn Thành').setStyle(ButtonStyle.Success).setEmoji(config.ui.emojis.success)
                );
                await (message.channel as any).send({ content: `<@${message.author.id}>`, embeds: [embed], components: [row] });
            }
        } 
        else if (message.channelId === config.channels.requestFree) {
            const requiredKeywords = ['[Service]', '[Request]'];
            const isValid = requiredKeywords.every(kw => content.includes(kw));

            if (!isValid) {
                await message.delete().catch(() => {});
            } else {
                // Transform to Embed
                await message.delete().catch(() => {});
                const service = getPart(content, 'Service');
                const requestDesc = getPart(content, 'Request');
                const other = getPart(content, 'Other');

                const embed = buildRequestFreeEmbed(message.author, service, requestDesc, other);
                const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId(`close_${message.author.id}`).setLabel('Hoàn Thành').setStyle(ButtonStyle.Success).setEmoji(config.ui.emojis.success)
                );
                await (message.channel as any).send({ content: `<@${message.author.id}>`, embeds: [embed], components: [row] });
            }
        }
        else if (message.channelId === config.channels.portfolio) {
            const requiredKeywords = ['[Tên]', '[Kinh nghiệm]', '[Dịch vụ]', '[Liên hệ]'];
            const isValid = requiredKeywords.every(kw => content.includes(kw));

            if (!isValid) {
                await message.delete().catch(() => {});
            } else {
                // Transform to Embed
                await message.delete().catch(() => {});
                const name = getPart(content, 'Tên');
                const exp = getPart(content, 'Kinh nghiệm');
                const service = getPart(content, 'Dịch vụ');
                const portfolio = getPart(content, 'Portfolio') || 'Không có';
                const contact = getPart(content, 'Liên hệ');

                const embed = buildPortfolioEmbed(message.author, name, exp, service, portfolio, contact);
                const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId(`bump_${message.author.id}`).setLabel('Bump Bài').setStyle(ButtonStyle.Primary).setEmoji(config.ui.emojis.bump)
                );
                await (message.channel as any).send({ content: `<@${message.author.id}>`, embeds: [embed], components: [row] });
            }
        }
        else if (message.channelId === config.channels.feedback) {
            const requiredKeywords = ['[User]', '[Sao]', '[Bằng chứng]'];
            const isFormatValid = requiredKeywords.every(kw => content.includes(kw));

            if (!isFormatValid) {
                await message.delete().catch(() => {});
                return;
            } else {
                const userText = getPart(content, 'User');
                const starsText = getPart(content, 'Sao');
                const proof = getPart(content, 'Bằng chứng');

                const stars = parseInt(starsText.replace(/[^0-9]/g, ''));
                if (isNaN(stars) || stars < 1 || stars > 5) {
                    await message.delete().catch(() => {});
                    return;
                }

                // Parse Discord user format <@123..>
                const targetMatch = userText.match(/<@!?(\d+)>/);
                if (!targetMatch) {
                    await message.delete().catch(() => {});
                    return;
                }

                const targetId = targetMatch[1];
                const rater = message.author;

                if (targetId === rater.id) {
                    await message.delete().catch(() => {});
                    return;
                }

                try {
                    const targetUser = await message.client.users.fetch(targetId);

                    await prisma.user.upsert({
                        where: { id: targetUser.id },
                        update: {},
                        create: { id: targetUser.id }
                    });

                    const newRate = await prisma.rate.create({
                        data: {
                            userId: targetUser.id,
                            raterId: rater.id,
                            stars,
                            proof
                        }
                    });

                    await message.delete().catch(() => {});

                    const aggregations = await prisma.rate.aggregate({
                        where: { userId: targetUser.id },
                        _avg: { stars: true },
                        _count: { id: true }
                    });
                    const avgStars = aggregations._avg.stars ? aggregations._avg.stars.toFixed(1) : stars;
                    const totalCount = aggregations._count.id;

                    const { emojis, colors } = config.ui;
                    const starString = emojis.star.repeat(stars) + emojis.emptyStar.repeat(5 - stars);
                    const embedColor = stars >= 4 ? colors.feedbackHigh : stars <= 2 ? colors.feedbackLow : colors.feedbackMed;

                    const embed = new EmbedBuilder()
                        .setColor(embedColor)
                        .setAuthor({ name: rater.tag, iconURL: rater.displayAvatarURL() })
                        .setTitle(`Đánh giá mới cho ${targetUser.username}`)
                        .setThumbnail(targetUser.displayAvatarURL())
                        .addFields(
                            { name: 'Người đánh giá', value: `<@${rater.id}>`, inline: true },
                            { name: 'Người nhận', value: `<@${targetUser.id}>`, inline: true },
                            { name: 'Số sao', value: `${starString} (${stars}/5)` },
                            { name: 'Bằng chứng', value: proof },
                            { name: 'Thống kê Tổng quát', value: `Tổng số: **${totalCount} đánh giá**\nTrung bình: **${avgStars} ${emojis.star}**` }
                        )
                        .setTimestamp();

                    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`appeal_${targetUser.id}_${newRate.id}`)
                            .setLabel('Khiếu Nại Đánh Giá')
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji(emojis.appeal)
                    );

                    await (message.channel as any).send({ embeds: [embed], components: [row] });
                } catch (e) {
                    console.error(e);
                    await message.delete().catch(() => {});
                    await (message.channel as any).send({ content: '❌ Lỗi kết nối Database.' });
                }
            }
        }
    },
};
