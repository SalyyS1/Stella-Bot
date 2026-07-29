import { Events, Message, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from '../config';
import { buildPortfolioEmbed } from '../utils/embedFormatter';
import { processMessageXp } from '../systems/xpManager';
import { createShowcasePost, isAllowedShowcaseMessage, isPublishedShowcaseThread } from '../systems/showcaseManager';
import { parseServerAd, publishServerAd } from '../systems/serverAdsManager';
import { sendAdminLog } from '../utils/adminLog';
import { getManagedChannelIds } from '../utils/managedChannels';
import { guardEveryoneMention } from '../systems/antiRaidManager';
import { levelScoinReward } from '../systems/scoinManager';
import { handleMusicPrefix } from '../systems/musicManager';
import { createCommunityRequest } from '../systems/requestManager';
import { isSkillKey } from '../systems/skillRoleManager';
import { isAiEnabled } from '../systems/aiClient';
import { reserveQaSlot, gateMessage, answerQuestion, splitForDiscord } from '../systems/aiQaManager';
import { handleTriviaAnswer } from '../systems/trivia-manager';
import { collectAnswer } from '../systems/knowledge/glossary-question-asker';
import { handleReminderRequest } from '../systems/reminder/reminder-handler';
import { buildEmojiHint, buildStickerHint, extractSticker } from '../systems/emoji-palette';

const getPart = (text: string, kw: string) => {
    // Regex lấy nội dung đằng sau [Keyword] cho tới gặp dấu [ tiếp theo hoặc hết chuỗi
    const regex = new RegExp(`\\[${kw}\\]([\\s\\S]*?)(?=\\[|$)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : '';
};

// Optional [Skill] tag in the text form → normalized skill key for match-ping.
// Free text, so lowercase and accept only a known key; anything else → null.
const getSkill = (text: string): string | null => {
    const raw = getPart(text, 'Skill').toLowerCase();
    return isSkillKey(raw) ? raw : null;
};

// AI Q&A in the dedicated channel. Returns true if the message was handled as a
// Q&A trigger (so the caller stops further processing).
async function handleAiQa(message: Message): Promise<boolean> {
    if (!isAiEnabled()) return false;

    let question: string | null = null;

    // Trigger (b): "!s <question>" — a fresh question, no reply needed.
    if (message.content.startsWith('!s ')) {
        question = message.content.slice(3).trim();
    } else if (message.reference?.messageId) {
        // Trigger (a): reply to one of the bot's OWN messages that pinged THIS user.
        const ref = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
        if (!ref || ref.author.id !== message.client.user?.id) return false;
        // Ownership: the bot message must have pinged this same user. Replying to a
        // bot answer meant for someone else is ignored (separate conversation lanes).
        if (!ref.mentions.users.has(message.author.id)) return false;
        question = message.content.trim();
    }

    if (!question) return false;
    if (question.length < 2) {
        await message.reply(`${config.ui.emojis.error} Câu hỏi hơi ngắn, thử hỏi rõ hơn nhé.`).catch(() => {});
        return true;
    }

    // Nhờ đặt lời nhắc? Xét TRƯỚC khi vào cổng Q&A, vì một câu nhờ nhắc không phải
    // câu hỏi: để nó đi tiếp thì người dùng vừa được đặt lịch lại vừa nhận một câu
    // trả lời AI về chính câu nhờ đó — tốn thêm một lượt gọi và đọc như bot bị lag.
    //
    // handleReminderRequest tự lọc rẻ trước (từ khoá giờ + ý nhờ nhắc) nên câu tán
    // gẫu thường không tốn lượt AI nào ở đây.
    if (await handleReminderRequest(message, question).catch(error => {
        console.error('[reminder] handler failed:', error);
        return false;
    })) {
        return true;
    }

    // Atomic reserve: claims the slot in the same sync call so a burst can't bypass the cap.
    const gate = reserveQaSlot(message.author.id);
    if (!gate.ok) {
        await message.reply(gateMessage(gate.reason)).catch(() => {});
        return true;
    }

    // sendTyping is best-effort (.catch) so it can't throw between reserve and
    // answerQuestion — answerQuestion always runs and releases the slot in its finally.
    await (message.channel as any).sendTyping?.().catch(() => {});
    // Emoji + sticker thật của server, dựng ở đây vì đây là nơi có Guild.
    // Best-effort: không có guild (DM) hoặc server không có emoji thì Stella dùng
    // emoji Unicode và không thả sticker.
    const palette = [buildEmojiHint(message.guild), buildStickerHint(message.guild)]
        .filter(Boolean)
        .join('\n');
    const raw = await answerQuestion(message.author.id, question, message.channelId, palette);
    // Tách marker [[sticker:tên]] TRƯỚC khi chia đoạn: model được dặn đặt nó ở cuối,
    // nên chia trước thì marker rơi vào đoạn cuối và đoạn đầu (đoạn được reply) mất
    // sticker — còn nếu tên sai thì marker phải bị xoá khỏi text bằng mọi giá.
    const { text: answer, stickerId } = extractSticker(raw, message.guild);
    // Answers can be long (config/skill samples) → embed (4096/desc) + split.
    // First message pings the asker so their follow-up reply is attributable.
    const chunks = splitForDiscord(answer);
    await message.reply({
        content: `<@${message.author.id}>`,
        embeds: [new EmbedBuilder().setColor('#5865F2').setDescription(chunks[0])],
        // Sticker gửi kèm tin đầu. Bọc trong mảng chỉ khi có: truyền `stickers: []`
        // là hợp lệ nhưng vô nghĩa, còn `undefined` thì discord.js bỏ hẳn field.
        ...(stickerId ? { stickers: [stickerId] } : {}),
        allowedMentions: { users: [message.author.id] }
    }).catch(() => {});
    for (const chunk of chunks.slice(1)) {
        await (message.channel as any).send?.({
            embeds: [new EmbedBuilder().setColor('#5865F2').setDescription(chunk)]
        }).catch(() => {});
    }
    return true;
}

async function warnInvalidRequestForm(message: Message, missing: string[]) {
    const warning = await message.reply({
        content: `${config.ui.emojis.error} Vui lòng điền nội dung cho: ${missing.map(name => `\`${name}\``).join(', ')}. Tin nhắn của bạn chưa bị xóa để có thể sửa lại.`
    }).catch(() => null);
    if (warning) setTimeout(() => warning.delete().catch(() => {}), 10_000);
}

export default {
    name: Events.MessageCreate,
    once: false,
    async execute(message: Message) {
        if (await guardEveryoneMention(message)) return;
        // Bỏ qua tin nhắn của bot
        if (message.author.bot) return;

        if (await handleMusicPrefix(message)) return;

        // Glossary: người có role tin cậy dạy Stella một thuật ngữ. Chạy ở MỌI kênh,
        // không chỉ kênh knowledge: điều kiện thật nằm trong collectAnswer (ping/reply
        // bot, đúng role, có cặp "từ = nghĩa"), nên chặn theo kênh ở đây chỉ làm
        // đường ping-ở-kênh-khác không bao giờ tới được hàm đó.
        //
        // Đặt TRƯỚC khối Q&A là có chủ ý: kênh Q&A `return` sớm khi handleAiQa nhận
        // việc, nên nếu để sau thì ping Stella "từ = nghĩa" ngay trong kênh đó sẽ bị
        // nuốt thành một câu hỏi AI — tốn một lượt gọi AI và không học được gì.
        // Học được thì dừng luôn: tin đó là lời dạy, không phải câu hỏi.
        const learned = await collectAnswer(message).catch(() => 0);
        if (learned > 0) {
            await message.react('✅').catch(() => {});
            return;
        }

        // === AI Q&A (kênh chỉ định) ===
        // Kích hoạt bằng: (a) reply vào tin bot đã ping CHÍNH bạn, hoặc (b) prefix "!s <câu hỏi>".
        // Reply vào tin bot trả lời người khác sẽ bị bỏ qua (chia luồng theo người).
        if (message.channelId === config.ai.qaChannel) {
            if (await handleAiQa(message)) return;
        }

        // Auto-trivia: in the chat channel, check if this message answers an open
        // question. Best-effort and non-blocking — a win is credited but the message
        // still flows through XP below (answering trivia is normal chatting).
        if (message.channelId === config.trivia.channelId) {
            await handleTriviaAnswer(message).catch(() => false);
        }

        // Better-showcase is publish-only: members may NOT open their own forum post
        // there, but they MUST be able to comment on a featured post. Threads the bot
        // published are therefore exempt — deleting one would destroy the featured
        // showcase (and its author's reward) over a single congratulation message.
        // Human-opened threads are already removed by the threadCreate guard; this
        // check only catches ones that slipped past it (e.g. created while offline).
        if (message.channel?.isThread() && message.channel.parentId === config.channels.betterShowcase) {
            const thread = message.channel;
            // Two independent signals, either of which spares the thread. The DB
            // checkpoint is authoritative (it is what publishing writes); ownerId is
            // the cheap in-memory hint. Deleting a featured post is irreversible, so
            // this must fail CLOSED — when in doubt, keep the thread.
            const botOwnsThread = thread.ownerId === message.client.user?.id
                || await isPublishedShowcaseThread(thread.id);
            const isAdmin = message.member?.permissions.has('Administrator') ?? false;
            if (!botOwnsThread && !isAdmin) {
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
                const embed = new EmbedBuilder()
                    .setColor('Red')
                    .setDescription('❌ Bài quảng cáo cần có `[NAME]` và `[Link]`. `[Description]`, `[IP]` là optional. Tin nhắn được giữ lại để bạn sửa.');
                const warningMsg = await message.reply({ embeds: [embed] }).catch(() => null);
                if (warningMsg) setTimeout(() => warningMsg.delete().catch(() => {}), 10000);
            } else {
                try {
                    await publishServerAd(message.channel as any, message.author, parsed);
                    await message.delete().catch(() => {});
                } catch (error) {
                    console.error('Failed to publish server ad:', error);
                    await message.reply(`${config.ui.emojis.error} Không thể đăng quảng cáo lúc này. Nội dung của bạn vẫn được giữ nguyên.`).catch(() => {});
                }
            }
        }
        else if (message.channelId === managedChannels.requestPaid) {
            const service = getPart(content, 'Service');
            const requestDesc = getPart(content, 'Request');
            const budget = getPart(content, 'Budget');
            const other = getPart(content, 'Other');
            const missing = [
                !service ? 'Service' : null,
                !requestDesc ? 'Request' : null,
                !budget ? 'Budget' : null
            ].filter(Boolean) as string[];
            if (missing.length) {
                await warnInvalidRequestForm(message, missing);
            } else {
                try {
                    await createCommunityRequest({
                        client: message.client,
                        channel: message.channel as any,
                        requester: message.author,
                        kind: 'PAID',
                        service,
                        description: requestDesc,
                        budget,
                        other,
                        skill: getSkill(content)
                    });
                    await message.delete().catch(() => {});
                } catch (error) {
                    console.error('Failed to create paid request:', error);
                    await message.reply(`${config.ui.emojis.error} Không thể tạo request lúc này. Nội dung của bạn vẫn được giữ nguyên, vui lòng thử lại.`).catch(() => {});
                }
            }
        } 
        else if (message.channelId === managedChannels.requestFree) {
            const service = getPart(content, 'Service');
            const requestDesc = getPart(content, 'Request');
            const other = getPart(content, 'Other');
            const missing = [!service ? 'Service' : null, !requestDesc ? 'Request' : null].filter(Boolean) as string[];
            if (missing.length) {
                await warnInvalidRequestForm(message, missing);
            } else {
                try {
                    await createCommunityRequest({
                        client: message.client,
                        channel: message.channel as any,
                        requester: message.author,
                        kind: 'FREE',
                        service,
                        description: requestDesc,
                        other,
                        skill: getSkill(content)
                    });
                    await message.delete().catch(() => {});
                } catch (error) {
                    console.error('Failed to create free request:', error);
                    await message.reply(`${config.ui.emojis.error} Không thể tạo request lúc này. Nội dung của bạn vẫn được giữ nguyên, vui lòng thử lại.`).catch(() => {});
                }
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
