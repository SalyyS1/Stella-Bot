import { Events, Interaction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { config } from '../config';
import { buildRequestPaidEmbed, buildRequestFreeEmbed, buildPortfolioEmbed } from '../utils/embedFormatter';
import { optOutShowcase, renderShowcaseControl, updateShowcaseTag, updateShowcaseTitle } from '../systems/showcaseManager';
import { isValidServerAdInput, publishServerAd } from '../systems/serverAdsManager';
import { sendAdminLog } from '../utils/adminLog';
import { getManagedChannelId, getManagedChannelIds } from '../utils/managedChannels';
import { createGiveaway, joinGiveaway, leaveGiveaway, GIVEAWAY_BANNER, parseDuration } from '../systems/giveawayManager';
import prisma from '../lib/prisma';
import { getPendingAnnouncement, sendAnnouncement, takePendingAnnouncement } from '../systems/announceManager';
import { controlMusic, musicPanel } from '../systems/musicManager';

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
            if (cmdName === 'maintenance') {
                try {
                    await command.execute(interaction);
                } catch (error: any) {
                    console.error(error);
                    await sendAdminLog(client, {
                        title: 'Command failed',
                        color: '#e74c3c',
                        fields: [
                            { name: 'Command', value: interaction.commandName, inline: true },
                            { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                            { name: 'Channel', value: interaction.channelId ? `<#${interaction.channelId}>` : 'Unknown', inline: true },
                            { name: 'Error', value: String(error?.stack || error).slice(0, 1000) }
                        ]
                    }).catch(() => {});
                    const content = `${config.ui.emojis.error} Lệnh lỗi: ${String(error?.message || error).slice(0, 300)}`;
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
                    } else {
                        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
                    }
                }
                return;
            }
            let expectedChannel = null;

            if (cmdName === 'requestpaid') expectedChannel = await getManagedChannelId('requestPaid');
            else if (cmdName === 'requestfree') expectedChannel = await getManagedChannelId('requestFree');
            else if (cmdName === 'portfolio') expectedChannel = config.channels.portfolio;
            const managedChannels = await getManagedChannelIds();

            if (expectedChannel && interaction.channelId !== expectedChannel) {
                return interaction.reply({ content: `${config.ui.emojis.error} Lệnh \`/${cmdName}\` chỉ được phép sử dụng trong kênh <#${expectedChannel}>.`, flags: MessageFlags.Ephemeral });
            }

            const restrictedChannels = [
                managedChannels.requestPaid,
                managedChannels.requestFree,
                config.channels.portfolio,
                config.channels.share,
                config.channels.showcase,
                managedChannels.serverAds
            ];

            if (!expectedChannel && restrictedChannels.includes(interaction.channelId)) {
                return interaction.reply({ content: `${config.ui.emojis.error} Không được phép dùng lệnh \`/${cmdName}\` ở kênh này để tránh trôi tin nhắn giao dịch!`, flags: MessageFlags.Ephemeral });
            }

            try {
                await command.execute(interaction);
            } catch (error: any) {
                console.error(error);
                await sendAdminLog(client, {
                    title: 'Command failed',
                    color: '#e74c3c',
                    fields: [
                        { name: 'Command', value: interaction.commandName, inline: true },
                        { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                        { name: 'Channel', value: interaction.channelId ? `<#${interaction.channelId}>` : 'Unknown', inline: true },
                        { name: 'Error', value: String(error?.stack || error).slice(0, 1000) }
                    ]
                }).catch(() => {});
                const content = `${config.ui.emojis.error} Lệnh lỗi: ${String(error?.message || error).slice(0, 300)}`;
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
                }
            }
        } 
        else if (interaction.isButton()) {
            const part = interaction.customId.split('_');
            const action = part[0];

            if (action === 'announce') {
                const type = part[1];
                const id = part[2];
                const pending = getPendingAnnouncement(id);
                if (!pending || pending.creatorId !== interaction.user.id) {
                    return interaction.reply({ content: `${config.ui.emojis.error} Preview nay da het han hoac khong phai cua ban.`, flags: MessageFlags.Ephemeral });
                }

                if (type === 'cancel') {
                    takePendingAnnouncement(id);
                    return interaction.update({ content: 'Da huy thong bao.', embeds: [], components: [] });
                }

                try {
                    const data = takePendingAnnouncement(id);
                    if (!data) throw new Error('Preview expired.');
                    const message = await sendAnnouncement(client, data);
                    return interaction.update({
                        content: `${config.ui.emojis.success} Da gui thong bao tai <#${message.channelId}>.`,
                        embeds: [],
                        components: []
                    });
                } catch (error: any) {
                    return interaction.reply({ content: `${config.ui.emojis.error} ${error?.message || 'Khong gui duoc thong bao.'}`, flags: MessageFlags.Ephemeral });
                }
            }

            if (action === 'music') {
                if (!interaction.guildId) return interaction.reply({ content: 'Chi dung music trong server.', flags: MessageFlags.Ephemeral });
                const type = part[1];
                try {
                    await controlMusic(interaction.client, interaction.guildId, type);
                    return interaction.update(musicPanel(interaction.client, interaction.guildId));
                } catch (error: any) {
                    return interaction.reply({ content: `${config.ui.emojis.error} ${error?.message || 'Music error.'}`, flags: MessageFlags.Ephemeral });
                }
            }

            if (action === 'giveaway') {
                const type = part[1];

                if (type === 'panel' && part[2] === 'create') {
                    const modal = new ModalBuilder().setCustomId('giveaway_quick_modal').setTitle('Tao Giveaway Nhanh');
                    const title = new TextInputBuilder().setCustomId('title').setLabel('Tieu de').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true);
                    const prize = new TextInputBuilder().setCustomId('prize').setLabel('Phan thuong').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(true);
                    const duration = new TextInputBuilder().setCustomId('duration').setLabel('Thoi luong (VD: 30m, 2h, 3d)').setStyle(TextInputStyle.Short).setRequired(true);
                    const winners = new TextInputBuilder().setCustomId('winners').setLabel('So winner').setStyle(TextInputStyle.Short).setRequired(true);
                    const description = new TextInputBuilder().setCustomId('description').setLabel('Mo ta').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false);
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(title),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(prize),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(duration),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(winners),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(description)
                    );
                    await showModalSafely(interaction, modal, client, 'giveaway_panel_create');
                    return;
                }

                const giveawayId = Number(part[2]);
                if (!Number.isFinite(giveawayId)) return;

                try {
                    if (type === 'join') {
                        if (!interaction.guild) throw new Error('Chi dung giveaway trong server.');
                        await joinGiveaway(client, interaction.guild, giveawayId, interaction.user.id);
                        return interaction.reply({ content: `${config.ui.emojis.success} Da tham gia giveaway #${giveawayId}.`, flags: MessageFlags.Ephemeral });
                    }
                    if (type === 'leave') {
                        await leaveGiveaway(client, giveawayId, interaction.user.id);
                        return interaction.reply({ content: `${config.ui.emojis.success} Da roi giveaway #${giveawayId}.`, flags: MessageFlags.Ephemeral });
                    }
                    if (type === 'participants') {
                        const entries = await prisma.giveawayEntry.findMany({ where: { giveawayId }, orderBy: { joinedAt: 'asc' }, take: 50 });
                        const lines = entries.map((entry, index) => `**${index + 1}.** <@${entry.userId}>`).join('\n') || 'Chua co ai tham gia.';
                        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#f1c40f').setTitle(`Participants #${giveawayId}`).setDescription(lines)], flags: MessageFlags.Ephemeral });
                    }
                } catch (error: any) {
                    return interaction.reply({ content: `${config.ui.emojis.error} ${error?.message || 'Da co loi khi xu ly giveaway.'}`, flags: MessageFlags.Ephemeral });
                }
                return;
            }

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

                const requestPaidChannelId = await getManagedChannelId('requestPaid');
                const targetChan = await interaction.client.channels.fetch(requestPaidChannelId).catch(() => null) as any;
                if (!targetChan) return interaction.reply({ content: 'Lỗi Kênh đích', flags: MessageFlags.Ephemeral });
                
                await interaction.reply({ content: `${config.ui.emojis.success} Đã tạo bài đăng thành công tại <#${requestPaidChannelId}>!`, flags: MessageFlags.Ephemeral });
                await targetChan.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [row] });

            } else if (interaction.customId === 'requestfree_modal') {
                const s = interaction.fields.getTextInputValue('service');
                const r = interaction.fields.getTextInputValue('request_desc');
                const o = interaction.fields.getTextInputValue('other');

                const embed = buildRequestFreeEmbed(interaction.user, s, r, o);
                const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`close_${interaction.user.id}`).setLabel('Hoàn Thành').setStyle(ButtonStyle.Success).setEmoji(config.ui.emojis.success));

                const requestFreeChannelId = await getManagedChannelId('requestFree');
                const targetChan = await interaction.client.channels.fetch(requestFreeChannelId).catch(() => null) as any;
                if (!targetChan) return interaction.reply({ content: 'Lỗi Kênh đích', flags: MessageFlags.Ephemeral });
                
                await interaction.reply({ content: `${config.ui.emojis.success} Đã tạo bài đăng thành công tại <#${requestFreeChannelId}>!`, flags: MessageFlags.Ephemeral });
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
                const serverAdsChannelId = await getManagedChannelId('serverAds');
                const channel = await interaction.client.channels.fetch(serverAdsChannelId).catch(() => null);
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
                await interaction.editReply(`${config.ui.emojis.success} Đã đăng quảng cáo tại <#${serverAdsChannelId}>.`);
            }
            else if (interaction.customId === 'giveaway_quick_modal') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                if (!interaction.memberPermissions?.has('Administrator')) {
                    return interaction.editReply('Ban can quyen Administrator de tao giveaway.');
                }
                const channel = interaction.channel as TextChannel;
                if (!channel?.isTextBased()) return interaction.editReply('Kenh hien tai khong hop le.');

                const durationMs = parseDuration(interaction.fields.getTextInputValue('duration'));
                const winners = Math.max(1, Math.min(20, Number(interaction.fields.getTextInputValue('winners')) || 1));
                const giveaway = await createGiveaway(client, {
                    channel,
                    title: interaction.fields.getTextInputValue('title'),
                    prize: interaction.fields.getTextInputValue('prize'),
                    description: interaction.fields.getTextInputValue('description') || 'Nhan nut ben duoi de tham gia giveaway.',
                    durationMs,
                    winnersCount: winners,
                    hostId: interaction.user.id,
                    publicMediaUrl: GIVEAWAY_BANNER,
                    createdBy: interaction.user.id
                });
                await interaction.editReply(`${config.ui.emojis.success} Da tao giveaway nhanh #${giveaway.id}.`);
            }
        }
    }
};
