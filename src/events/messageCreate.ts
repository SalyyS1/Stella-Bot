import { Events, Message, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from '../config';
import { buildPortfolioEmbed } from '../utils/embedFormatter';
import { processMessageXp } from '../systems/xpManager';
import { createShowcasePost, isAllowedShowcaseMessage } from '../systems/showcaseManager';
import { parseServerAd, publishServerAd } from '../systems/serverAdsManager';
import { sendAdminLog } from '../utils/adminLog';
import { getManagedChannelIds } from '../utils/managedChannels';
import { guardEveryoneMention } from '../systems/antiRaidManager';
import { adjustScoin, levelScoinReward } from '../systems/scoinManager';
import { handleMusicPrefix } from '../systems/musicManager';
import { createCommunityRequest } from '../systems/requestManager';

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
        await guardEveryoneMention(message);
        // Bỏ qua tin nhắn của bot
        if (message.author.bot) return;

        if (await handleMusicPrefix(message)) return;

        if (message.channel?.isThread() && message.channel.parentId === config.channels.betterShowcase) {
            const isAdmin = message.member?.permissions.has('Administrator') ?? false;
            if (!isAdmin) {
                const thread = message.channel;
                await sendAdminLog(message.client, {
                    title: 'Unauthorized better-showcase post blocked',
                    color: '#e74c3c',
                    fields: [
                        { name: 'User', value: `<@${message.author.id}>`, inline: true },
                        { name: 'Thread', value: thread.name || thread.id, inline: true }
                    ]
                }).catch(() => {});
                await message.author.send('Bài trong better-showcase chỉ được đăng tự động sau khi showcase đạt đủ vote. Hãy đăng bài ở kênh showcase trước nhé.').catch(() => {});
                await thread.delete('Unauthorized direct better-showcase post').catch(() => {
                    message.delete().catch(() => {});
                });
                return;
            }
        }

        if (message.channelId === config.channels.welcome) {
            await message.delete().catch(() => {});
            const warning = await (message.channel as any).send({
                content: `<@${message.author.id}> ${config.ui.emojis.error} Kênh welcome chỉ dùng để bot thông báo, vui lòng chat tại <#${config.channels.chat}>.`
            }).catch(() => null);
            if (warning) setTimeout(() => warning.delete().catch(() => {}), 8000);
            return;
        }

        // === XP TRACKING (chạy ngầm, không block) ===
        if (message.guild && message.member) {
            processMessageXp(message.author.id, message.content, message.guild, message.member).then(async result => {
                if (result?.leveledUp) {
                    const scoinReward = levelScoinReward(result.newLevel);
                    await adjustScoin(message.author.id, scoinReward, `Level ${result.newLevel} reward`, 'level').catch(() => null);
                    const emojis = config.ui.emojis;
                    const logChannel = message.client.channels.cache.get(config.channels.levelUp) as any;
                    if (logChannel) {
                        const embed = new EmbedBuilder()
                            .setColor('#f1c40f')
                            .setDescription(`${emojis.success} **${message.author.username}** vừa lên **Level ${result.newLevel}**! 🎉\n${config.ui.emojis.budget} Thưởng **${scoinReward.toLocaleString('vi-VN')}** Scoin`)
                            .setFooter({ text: 'Stella Studio · Level System' });
                        logChannel.send({ embeds: [embed] }).catch(() => {});
                    }
                    sendAdminLog(message.client, {
                        title: 'Level up',
                        color: '#f1c40f',
                        fields: [
                            { name: 'User', value: `<@${message.author.id}>`, inline: true },
                            { name: 'Level', value: `${result.oldLevel} -> ${result.newLevel}`, inline: true },
                            { name: 'Source', value: 'Message XP', inline: true }
                        ]
                    }).catch(() => {});
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
        const managedChannels = await getManagedChannelIds();

        if (message.channelId === managedChannels.serverAds) {
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
        else if (message.channelId === managedChannels.requestPaid) {
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

                await createCommunityRequest({
                    client: message.client,
                    channel: message.channel as any,
                    requester: message.author,
                    kind: 'PAID',
                    service,
                    description: requestDesc,
                    budget,
                    other
                });
            }
        } 
        else if (message.channelId === managedChannels.requestFree) {
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

                await createCommunityRequest({
                    client: message.client,
                    channel: message.channel as any,
                    requester: message.author,
                    kind: 'FREE',
                    service,
                    description: requestDesc,
                    other
                });
            }
        }
        else if ([
            config.channels.portfolio,
            config.channels.botLog
        ].includes(message.channelId)) {
            await message.delete().catch(() => {});
            const warning = await (message.channel as any).send({
                content: `<@${message.author.id}> ${config.ui.emojis.error} Tin nhắn không đúng khu vực đã bị xoá.`
            }).catch(() => null);
            if (warning) setTimeout(() => warning.delete().catch(() => {}), 8000);
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
    },
};
