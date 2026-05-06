import { Events, Interaction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder } from 'discord.js';
import { config } from '../config';
import prisma from '../lib/prisma';
import { buildRequestPaidEmbed, buildRequestFreeEmbed, buildPortfolioEmbed } from '../utils/embedFormatter';
import { optOutShowcase, renderShowcaseControl, updateShowcaseTag, updateShowcaseTitle } from '../systems/showcaseManager';
import { isValidServerAdInput, publishServerAd } from '../systems/serverAdsManager';
import { sendAdminLog } from '../utils/adminLog';

async function showModalSafely(interaction: any, modal: ModalBuilder, client: any, context: string) {
    try {
        await interaction.showModal(modal);
    } catch (error: any) {
        await sendAdminLog(client, {
            title: 'Modal open failed',
            color: '#e74c3c',
            fields: [
                { name: 'Context', value: context, inline: true },
                { name: 'User', value: `<@${interaction.user?.id}>`, inline: true },
                { name: 'Error', value: `${error?.code || 'unknown'} ${error?.message || error}` }
            ]
        });

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: `${config.ui.emojis.error} Không mở được form. Vui lòng bấm lại sau vài giây.`,
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    }
}

export default {
    name: Events.InteractionCreate,
    once: false,
    async execute(interaction: Interaction, client: any) {
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            // Channel Validation Logic
            const cmdName = interaction.commandName;
            let expectedChannel = null;

            if (cmdName === 'requestpaid') expectedChannel = config.channels.requestPaid;
            else if (cmdName === 'requestfree') expectedChannel = config.channels.requestFree;
            else if (cmdName === 'portfolio') expectedChannel = config.channels.portfolio;
            else if (cmdName === 'feedback') expectedChannel = config.channels.feedback;

            if (expectedChannel && interaction.channelId !== expectedChannel) {
                return interaction.reply({ content: `${config.ui.emojis.error} Lệnh \`/${cmdName}\` chỉ được phép sử dụng trong kênh <#${expectedChannel}>.`, flags: MessageFlags.Ephemeral });
            }

            const restrictedChannels = [
                config.channels.requestPaid,
                config.channels.requestFree,
                config.channels.portfolio,
                config.channels.feedback,
                config.channels.share,
                config.channels.showcase,
                config.channels.serverAds
            ];

            if (!expectedChannel && restrictedChannels.includes(interaction.channelId)) {
                return interaction.reply({ content: `${config.ui.emojis.error} Không được phép dùng lệnh \`/${cmdName}\` ở kênh này để tránh trôi tin nhắn giao dịch!`, flags: MessageFlags.Ephemeral });
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(error);
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'Đã có lỗi xảy ra!', ephemeral: true });
                } else {
                    await interaction.reply({ content: 'Đã có lỗi xảy ra!', ephemeral: true });
                }
            }
        } 
        else if (interaction.isButton()) {
            const part = interaction.customId.split('_');
            const action = part[0];

            if (action === 'showcase') {
                const type = part[1];
                const messageId = part[2];

                if (type === 'settings') {
                    const modal = new ModalBuilder()
                        .setCustomId(`showcasetitle_${messageId}`)
                        .setTitle('Showcase Settings');
                    const title = new TextInputBuilder()
                        .setCustomId('title')
                        .setLabel('Showcase title')
                        .setPlaceholder(`Showcase by ${interaction.user.username}`)
                        .setStyle(TextInputStyle.Short)
                        .setMaxLength(100)
                        .setRequired(true);
                    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(title));
                    await showModalSafely(interaction, modal, client, 'showcase_settings');
                } else if (type === 'optout') {
                    const ok = await optOutShowcase(client, messageId, interaction.user);
                    if (!ok) {
                        return interaction.reply({ content: `${config.ui.emojis.error} Không thể opt out bài showcase này.`, flags: MessageFlags.Ephemeral });
                    }
                    const rendered = await renderShowcaseControl(client, messageId, interaction.user);
                    if (rendered) {
                        await interaction.update(rendered);
                    } else {
                        await interaction.reply({ content: `${config.ui.emojis.success} Đã opt out showcase.`, flags: MessageFlags.Ephemeral });
                    }
                }
                return;
            }

            if (action === 'panel') {
                const type = part[1];

                if (type === 'paid') {
                    const modal = new ModalBuilder().setCustomId('requestpaid_modal').setTitle('Yêu Cầu Có Phí (Paid)');
                    const s = new TextInputBuilder().setCustomId('service').setLabel('Dịch vụ cần?').setStyle(TextInputStyle.Short).setRequired(true);
                    const r = new TextInputBuilder().setCustomId('request_desc').setLabel('Chi tiết yêu cầu').setStyle(TextInputStyle.Paragraph).setRequired(true);
                    const b = new TextInputBuilder().setCustomId('budget').setLabel('Ngân sách (Ví dụ: 1M)').setStyle(TextInputStyle.Short).setRequired(true);
                    const o = new TextInputBuilder().setCustomId('other').setLabel('Liên hệ/Khác').setStyle(TextInputStyle.Paragraph).setRequired(false);
                    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(s), new ActionRowBuilder<TextInputBuilder>().addComponents(r), new ActionRowBuilder<TextInputBuilder>().addComponents(b), new ActionRowBuilder<TextInputBuilder>().addComponents(o));
                    await showModalSafely(interaction, modal, client, 'panel_paid');
                } 
                else if (type === 'free') {
                    const modal = new ModalBuilder().setCustomId('requestfree_modal').setTitle('Yêu Cầu Giúp Đỡ (Free)');
                    const s = new TextInputBuilder().setCustomId('service').setLabel('Việc cần giúp?').setStyle(TextInputStyle.Short).setRequired(true);
                    const r = new TextInputBuilder().setCustomId('request_desc').setLabel('Chi tiết').setStyle(TextInputStyle.Paragraph).setRequired(true);
                    const o = new TextInputBuilder().setCustomId('other').setLabel('Liên hệ').setStyle(TextInputStyle.Paragraph).setRequired(false);
                    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(s), new ActionRowBuilder<TextInputBuilder>().addComponents(r), new ActionRowBuilder<TextInputBuilder>().addComponents(o));
                    await showModalSafely(interaction, modal, client, 'panel_free');
                }
                else if (type === 'port') {
                    const modal = new ModalBuilder().setCustomId('portfolio_modal').setTitle('Quảng Bá Bản Thân');
                    const n = new TextInputBuilder().setCustomId('name').setLabel('Tên/Tuổi').setStyle(TextInputStyle.Short).setRequired(true);
                    const e = new TextInputBuilder().setCustomId('experience').setLabel('Kinh nghiệm').setStyle(TextInputStyle.Short).setRequired(true);
                    const s = new TextInputBuilder().setCustomId('service').setLabel('Dịch vụ').setStyle(TextInputStyle.Short).setRequired(true);
                    const p = new TextInputBuilder().setCustomId('portfolio_link').setLabel('Link Sản Phẩm').setStyle(TextInputStyle.Short).setRequired(true);
                    const c = new TextInputBuilder().setCustomId('contact').setLabel('Liên hệ').setStyle(TextInputStyle.Short).setRequired(true);
                    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(n), new ActionRowBuilder<TextInputBuilder>().addComponents(e), new ActionRowBuilder<TextInputBuilder>().addComponents(s), new ActionRowBuilder<TextInputBuilder>().addComponents(p), new ActionRowBuilder<TextInputBuilder>().addComponents(c));
                    await showModalSafely(interaction, modal, client, 'panel_portfolio');
                }
                else if (type === 'feed') {
                    const userSelect = new UserSelectMenuBuilder()
                        .setCustomId('panel_feed_select')
                        .setPlaceholder('Chọn một người bạn muốn đánh giá...')
                        .setMaxValues(1);

                    const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(userSelect);
                    await interaction.reply({ content: `Vui lòng chọn người bạn muốn đánh giá bằng Menu bên dưới:`, components: [row], flags: MessageFlags.Ephemeral });
                }
                else if (type === 'suggest') {
                    const modal = new ModalBuilder().setCustomId('suggest_modal').setTitle('Gửi Đề Xuất');
                    const t = new TextInputBuilder().setCustomId('suggest_title').setLabel('Tiêu đề đề xuất').setPlaceholder('Ví dụ: Thêm kênh share resource pack...').setStyle(TextInputStyle.Short).setRequired(true);
                    const d = new TextInputBuilder().setCustomId('suggest_desc').setLabel('Mô tả chi tiết').setPlaceholder('Mô tả rõ hơn ý tưởng của bạn...').setStyle(TextInputStyle.Paragraph).setRequired(true);
                    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(t), new ActionRowBuilder<TextInputBuilder>().addComponents(d));
                    await showModalSafely(interaction, modal, client, 'panel_suggest');
                }
                else if (type === 'serverads') {
                    const modal = new ModalBuilder().setCustomId('serverads_modal').setTitle('Đăng Server Ads');
                    const name = new TextInputBuilder().setCustomId('name').setLabel('Tên server').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true);
                    const desc = new TextInputBuilder().setCustomId('description').setLabel('Mô tả ngắn').setStyle(TextInputStyle.Paragraph).setMaxLength(800).setRequired(false);
                    const link = new TextInputBuilder().setCustomId('link').setLabel('Link Discord').setStyle(TextInputStyle.Short).setRequired(true);
                    const ip = new TextInputBuilder().setCustomId('ip').setLabel('IP Minecraft (optional)').setStyle(TextInputStyle.Short).setRequired(false);
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(name),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(desc),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(link),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(ip)
                    );
                    await showModalSafely(interaction, modal, client, 'panel_serverads');
                }
                return;
            }

            // Handling traditional buttons
            const authorId = part[1];
            
            if (action === 'close' || action === 'bump') {
                if (interaction.user.id !== authorId && !interaction.memberPermissions?.has('Administrator')) {
                    await interaction.reply({ content: `${config.ui.emojis.error} Bạn không phải là tác giả của bài đăng này!`, flags: MessageFlags.Ephemeral });
                    return;
                }

                if (action === 'close') {
                    const oldEmbed = interaction.message.embeds[0];
                    if (!oldEmbed) return;

                    const newEmbed = EmbedBuilder.from(oldEmbed)
                        .setColor('Red')
                        .setTitle('[CLOSED] ' + (oldEmbed.title?.replace('[CLOSED] ', '') || ''))
                        .setFooter({ text: 'Trạng thái: Đã đóng (Tìm được người/Xong)' });

                    const components = interaction.message.components.map((row: any) => {
                        const actionRow = new ActionRowBuilder<ButtonBuilder>();
                        row.components.forEach((c: any) => {
                            if (c.type === 2) {
                                actionRow.addComponents(ButtonBuilder.from(c as any).setDisabled(true));
                            }
                        });
                        return actionRow;
                    });

                    await interaction.update({ embeds: [newEmbed], components: components });
                    await interaction.followUp({ content: `${config.ui.emojis.success} Đã đóng bài đăng thành công!`, flags: MessageFlags.Ephemeral });
                } else if (action === 'bump') {
                    const oldEmbed = interaction.message.embeds[0];
                    const oldComponents = interaction.message.components;
                    const oldContent = interaction.message.content;

                    await interaction.message.delete().catch(() => {});
                    
                    await (interaction.channel as TextChannel).send({
                        content: oldContent,
                        embeds: [oldEmbed],
                        components: oldComponents as any
                    });

                    await interaction.reply({ content: `${config.ui.emojis.bump} Đã bump bài lên top!`, flags: MessageFlags.Ephemeral });
                }
                return;
            }

            if (action === 'appeal') {
                const targetId = part[1];
                const rateId = parseInt(part[2]);

                if (interaction.user.id !== targetId) {
                    return interaction.reply({ content: `${config.ui.emojis.error} Bạn không phải là người bị đánh giá, bạn không có quyền khiếu nại!`, flags: MessageFlags.Ephemeral });
                }

                const oldEmbed = interaction.message.embeds[0];
                if (!oldEmbed) return;

                const newEmbed = EmbedBuilder.from(oldEmbed).setFooter({ text: '🔴 Đang bị khiếu nại - Đợi Staff xử lý' });

                const staffRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId(`delrate_${rateId}`).setLabel('Xoá Đánh Giá').setStyle(ButtonStyle.Danger).setEmoji(config.ui.emojis.delete),
                    new ButtonBuilder().setCustomId(`keeprate_${rateId}`).setLabel('Giữ Nguyên').setStyle(ButtonStyle.Secondary).setEmoji(config.ui.emojis.keep)
                );

                await interaction.update({ embeds: [newEmbed], components: [staffRow] });

                const content = interaction.message.content;
                const newContent = `${content}\n<@&${config.roles.appealStaff}> ⚠️ Người dùng khiếu nại đánh giá này, vui lòng xử lý!`.trim();
                
                await interaction.message.edit({ content: newContent });
                await interaction.followUp({ content: `${config.ui.emojis.success} Đã báo cáo khiếu nại tới Staff!`, flags: MessageFlags.Ephemeral });
                return;
            }

            if (action === 'delrate' || action === 'keeprate') {
                const hasRole = (interaction.member?.roles as any).cache.has(config.roles.appealStaff) || interaction.memberPermissions?.has('Administrator');
                if (!hasRole) {
                    return interaction.reply({ content: `${config.ui.emojis.error} Bạn không có quyền xử lý khiếu nại!`, flags: MessageFlags.Ephemeral });
                }

                const rateId = parseInt(part[1]);
                const oldEmbed = interaction.message.embeds[0];

                if (action === 'delrate') {
                    try { await prisma.rate.delete({ where: { id: rateId } }).catch(() => {}); } catch (e) {}

                    const newEmbed = EmbedBuilder.from(oldEmbed)
                        .setColor('Red')
                        .setFooter({ text: 'ĐÁNH GIÁ ĐÃ BỊ XOÁ DO KHIẾU NẠI THÀNH CÔNG!' });
                    
                    await interaction.update({ content: 'Xử lý thành công', embeds: [newEmbed], components: [] });
                    await interaction.followUp({ content: `${config.ui.emojis.success} Đã xoá record Rate khỏi Database thành công.`, flags: MessageFlags.Ephemeral });
                } else if (action === 'keeprate') {
                    const newEmbed = EmbedBuilder.from(oldEmbed).setFooter({ text: 'KHIẾU NẠI ĐÃ BỊ STAFF TỪ CHỐI!' });
                    await interaction.update({ content: 'Xử lý thành công', embeds: [newEmbed], components: [] });
                    await interaction.followUp({ content: `${config.ui.emojis.success} Đã từ chối khiếu nại, giữ nguyên đánh giá.`, flags: MessageFlags.Ephemeral });
                }
            }
        } 
        else if (interaction.isUserSelectMenu()) {
            if (interaction.customId === 'panel_feed_select') {
                const targetUserId = interaction.values[0];
                
                // Pop up the Modal
                const modal = new ModalBuilder()
                    .setCustomId(`feedbackmodal_${targetUserId}`)
                    .setTitle('Đánh Giá Trải Nghiệm');

                const starsInput = new TextInputBuilder().setCustomId('stars').setLabel('Số sao (1-5)').setStyle(TextInputStyle.Short).setRequired(true);
                const proofInput = new TextInputBuilder().setCustomId('proof').setLabel('Link Discord/Ảnh bằng chứng').setStyle(TextInputStyle.Short).setRequired(true);
                
                modal.addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(starsInput),
                    new ActionRowBuilder<TextInputBuilder>().addComponents(proofInput)
                );

                await showModalSafely(interaction, modal, client, 'feedback_user_select');
            }
        } else if (interaction.isStringSelectMenu()) {
            if (interaction.customId.startsWith('showcase_tag_')) {
                const messageId = interaction.customId.replace('showcase_tag_', '');
                const tagName = interaction.values[0];
                const ok = await updateShowcaseTag(client, messageId, interaction.user, tagName);
                if (!ok) {
                    return interaction.reply({ content: `${config.ui.emojis.error} Không thể đổi tag showcase này.`, flags: MessageFlags.Ephemeral });
                }
                const rendered = await renderShowcaseControl(client, messageId, interaction.user);
                if (rendered) await interaction.update(rendered);
                else await interaction.reply({ content: `${config.ui.emojis.success} Đã đổi tag thành ${tagName}.`, flags: MessageFlags.Ephemeral });
            }
        }
        else if (interaction.isModalSubmit()) {
            if (interaction.customId === 'requestpaid_modal') {
                const s = interaction.fields.getTextInputValue('service');
                const r = interaction.fields.getTextInputValue('request_desc');
                const b = interaction.fields.getTextInputValue('budget');
                const o = interaction.fields.getTextInputValue('other');

                const embed = buildRequestPaidEmbed(interaction.user, s, r, b, o);
                const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`close_${interaction.user.id}`).setLabel('Hoàn Thành').setStyle(ButtonStyle.Success).setEmoji(config.ui.emojis.success));

                const targetChan = interaction.client.channels.cache.get(config.channels.requestPaid) as any;
                if (!targetChan) return interaction.reply({ content: 'Lỗi Kênh đích', flags: MessageFlags.Ephemeral });
                
                await interaction.reply({ content: `${config.ui.emojis.success} Đã tạo bài đăng thành công tại <#${config.channels.requestPaid}>!`, flags: MessageFlags.Ephemeral });
                await targetChan.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [row] });

            } else if (interaction.customId === 'requestfree_modal') {
                const s = interaction.fields.getTextInputValue('service');
                const r = interaction.fields.getTextInputValue('request_desc');
                const o = interaction.fields.getTextInputValue('other');

                const embed = buildRequestFreeEmbed(interaction.user, s, r, o);
                const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`close_${interaction.user.id}`).setLabel('Hoàn Thành').setStyle(ButtonStyle.Success).setEmoji(config.ui.emojis.success));

                const targetChan = interaction.client.channels.cache.get(config.channels.requestFree) as any;
                if (!targetChan) return interaction.reply({ content: 'Lỗi Kênh đích', flags: MessageFlags.Ephemeral });
                
                await interaction.reply({ content: `${config.ui.emojis.success} Đã tạo bài đăng thành công tại <#${config.channels.requestFree}>!`, flags: MessageFlags.Ephemeral });
                await targetChan.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [row] });

            } else if (interaction.customId === 'portfolio_modal') {
                const n = interaction.fields.getTextInputValue('name');
                const e = interaction.fields.getTextInputValue('experience');
                const s = interaction.fields.getTextInputValue('service');
                const p = interaction.fields.getTextInputValue('portfolio_link');
                const c = interaction.fields.getTextInputValue('contact');

                const embed = buildPortfolioEmbed(interaction.user, n, e, s, p, c);
                const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`bump_${interaction.user.id}`).setLabel('Bump Bài').setStyle(ButtonStyle.Primary).setEmoji(config.ui.emojis.bump));

                const targetChan = interaction.client.channels.cache.get(config.channels.portfolio) as any;
                if (!targetChan) return interaction.reply({ content: 'Lỗi Kênh đích', flags: MessageFlags.Ephemeral });
                
                await interaction.reply({ content: `${config.ui.emojis.success} Đã đăng portfolio thành công tại <#${config.channels.portfolio}>!`, flags: MessageFlags.Ephemeral });
                await targetChan.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [row] });
            }
            else if (interaction.customId === 'suggest_modal') {
                const title = interaction.fields.getTextInputValue('suggest_title');
                const desc = interaction.fields.getTextInputValue('suggest_desc');
                const emojis = config.ui.emojis;

                const suggestChan = interaction.client.channels.cache.get(config.channels.suggestions) as any;
                if (!suggestChan) return interaction.reply({ content: `${emojis.error} Không tìm thấy kênh suggestions.`, flags: MessageFlags.Ephemeral });

                const embed = new EmbedBuilder()
                    .setColor('#5865F2')
                    .setAuthor({ name: `${interaction.user.username} đề xuất`, iconURL: interaction.user.displayAvatarURL() })
                    .setTitle(`💡 ${title}`)
                    .setDescription(
                        `─────────────────────────\n` +
                        `${desc}\n` +
                        `─────────────────────────`
                    )
                    .addFields(
                        { name: '👤 Người đề xuất', value: `<@${interaction.user.id}>`, inline: true },
                        { name: '📊 Trạng thái', value: '🟡 Đang chờ duyệt', inline: true },
                        { name: '🗳️ Bình chọn', value: 'React bên dưới để vote!', inline: false }
                    )
                    .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
                    .setFooter({ text: 'Stella Studio · Hệ thống đề xuất', iconURL: interaction.client.user?.displayAvatarURL() })
                    .setTimestamp();

                const msg = await suggestChan.send({ embeds: [embed] });

                // Auto-react vote (dùng name:id format)
                const upMatch = emojis.upvote.match(/<(?:a)?:(\w+):(\d+)>/);
                const downMatch = emojis.downvote.match(/<(?:a)?:(\w+):(\d+)>/);
                if (upMatch) await msg.react(`${upMatch[1]}:${upMatch[2]}`).catch(() => {});
                if (downMatch) await msg.react(`${downMatch[1]}:${downMatch[2]}`).catch(() => {});

                await interaction.reply({ content: `${emojis.success} Đã gửi đề xuất thành công tại <#${config.channels.suggestions}>!`, flags: MessageFlags.Ephemeral });
            }
            else if (interaction.customId.startsWith('feedbackmodal_')) {
                // Handling Feedback Modal from Panel!
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const targetUserId = interaction.customId.split('_')[1];
                const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);
                
                const starsRaw = interaction.fields.getTextInputValue('stars');
                const stars = parseInt(starsRaw);
                const proof = interaction.fields.getTextInputValue('proof');
                const rater = interaction.user;

                if (!targetUser) return interaction.editReply(`${config.ui.emojis.error} Không tìm thấy người dùng.`);
                if (targetUser.id === rater.id) return interaction.editReply(`${config.ui.emojis.error} Bạn không thể tự rate chính mình.`);
                if (targetUser.bot) return interaction.editReply(`${config.ui.emojis.error} Bạn không thể rate bot.`);
                if (isNaN(stars) || stars < 1 || stars > 5) return interaction.editReply(`${config.ui.emojis.error} Số sao không hợp lệ (1-5).`);

                try {
                    await prisma.user.upsert({ where: { id: targetUser.id }, update: {}, create: { id: targetUser.id } });
                    const newRate = await prisma.rate.create({ data: { userId: targetUser.id, raterId: rater.id, stars, proof } });

                    const aggregations = await prisma.rate.aggregate({ where: { userId: targetUser.id }, _avg: { stars: true }, _count: { id: true } });
                    const avgStars = aggregations._avg.stars ? aggregations._avg.stars.toFixed(1) : stars;
                    const totalCount = aggregations._count.id;

                    const fbChan = interaction.client.channels.cache.get(config.channels.feedback) as any;
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
                            { name: 'Số sao', value: `${starString} (**${stars}** / 5)` },
                            { name: 'Bằng chứng', value: proof },
                            { name: 'Thống kê Tổng quát', value: `Tổng: **${totalCount}** review\nPhẩy: **${avgStars}** ${emojis.star}` }
                        )
                        .setTimestamp();

                    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder().setCustomId(`appeal_${targetUser.id}_${newRate.id}`).setLabel('Khiếu Nại Đánh Giá').setStyle(ButtonStyle.Danger).setEmoji(emojis.appeal)
                    );

                    if (fbChan) {
                        await fbChan.send({ embeds: [embed], components: [row] });
                        await interaction.editReply(`${config.ui.emojis.success} Đã gửi feedback thành công tại <#${config.channels.feedback}>!`);

                        // HIDE original dropdown menu message
                        await interaction.message?.delete().catch(() => {});
                    } else {
                        await interaction.editReply(`${config.ui.emojis.error} Không tìm thấy kênh Feedback.`);
                    }

                } catch (e) {
                    interaction.editReply(`${config.ui.emojis.error} Lỗi DB: ${e}`);
                }
            }
            else if (interaction.customId.startsWith('showcasetitle_')) {
                const messageId = interaction.customId.replace('showcasetitle_', '');
                const title = interaction.fields.getTextInputValue('title');
                const ok = await updateShowcaseTitle(client, messageId, interaction.user, title);
                if (!ok) {
                    return interaction.reply({ content: `${config.ui.emojis.error} Không thể đổi title showcase này.`, flags: MessageFlags.Ephemeral });
                }
                await interaction.reply({ content: `${config.ui.emojis.success} Đã cập nhật title showcase.`, flags: MessageFlags.Ephemeral });
            }
            else if (interaction.customId === 'serverads_modal') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const channel = await interaction.client.channels.fetch(config.channels.serverAds).catch(() => null);
                if (!channel || !channel.isTextBased()) {
                    return interaction.editReply(`${config.ui.emojis.error} Không tìm thấy kênh server-ads.`);
                }

                const input = {
                    name: interaction.fields.getTextInputValue('name'),
                    description: interaction.fields.getTextInputValue('description'),
                    link: interaction.fields.getTextInputValue('link'),
                    ip: interaction.fields.getTextInputValue('ip')
                };

                if (!isValidServerAdInput(input)) {
                    await sendAdminLog(interaction.client, {
                        title: 'Server ads rejected',
                        color: '#e74c3c',
                        fields: [
                            { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                            { name: 'Name', value: input.name || 'Trống', inline: true },
                            { name: 'Link', value: input.link || 'Trống' }
                        ]
                    });
                    return interaction.editReply(`${config.ui.emojis.error} Server Ads cần có tên và link Discord/http hợp lệ.`);
                }

                await publishServerAd(channel as TextChannel, interaction.user, input);
                await interaction.editReply(`${config.ui.emojis.success} Đã đăng quảng cáo tại <#${config.channels.serverAds}>.`);
            }
        }
    }
};
