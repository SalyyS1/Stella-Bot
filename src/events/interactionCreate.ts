import { Events, Interaction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, GuildMember, StringSelectMenuBuilder } from 'discord.js';
import { config } from '../config';
import { buildPortfolioEmbed } from '../utils/embedFormatter';
import { optOutShowcase, renderShowcaseControl, updateShowcaseTag, updateShowcaseTitle } from '../systems/showcaseManager';
import { isValidServerAdInput, publishServerAd } from '../systems/serverAdsManager';
import { sendAdminLog } from '../utils/adminLog';
import { getManagedChannelId, getManagedChannelIds } from '../utils/managedChannels';
import { createGiveaway, joinGiveaway, leaveGiveaway, GIVEAWAY_BANNER, parseDuration } from '../systems/giveawayManager';
import { takeGiveawayDraft } from '../systems/giveawayDraftManager';
import prisma from '../lib/prisma';
import { getPendingAnnouncement, sendAnnouncement, takePendingAnnouncement } from '../systems/announceManager';
import { controlMusic, musicPanel } from '../systems/musicManager';
import { claimRequest, closeRequest, completeRequest, createCommunityRequest, rateRequest, REQUEST_ALREADY_RATED } from '../systems/requestManager';
import { isSkillKey, toggleSkillRole, getSkillMeta } from '../systems/skillRoleManager';
import { markFirstPortfolio, grantVerifiedRole } from '../systems/freelancerManager';
import { approveCrossPost, rejectCrossPost } from '../systems/facebookCrossPostManager';

async function safeInteractionReply(interaction: any, payload: any) {
    try {
        if (interaction.replied || interaction.deferred) return await interaction.followUp(payload);
        return await interaction.reply(payload);
    } catch (error: any) {
        if (error?.code !== 10062 && error?.code !== 40060) console.error(error);
        return null;
    }
}

async function safeDeferEphemeral(interaction: any) {
    if (interaction.deferred || interaction.replied) return true;
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return true;
    } catch (error: any) {
        if (error?.code !== 10062 && error?.code !== 40060) console.error(error);
        return false;
    }
}

async function safeDeferUpdate(interaction: any) {
    if (interaction.deferred || interaction.replied) return true;
    try {
        await interaction.deferUpdate();
        return true;
    } catch (error: any) {
        if (error?.code !== 10062 && error?.code !== 40060) console.error(error);
        return false;
    }
}

async function createRequestFromModal(interaction: any, client: any, kind: 'PAID' | 'FREE', skill: string | null) {
    const acknowledged = await safeDeferEphemeral(interaction);
    if (!acknowledged) return;

    try {
        const service = interaction.fields.getTextInputValue('service').trim();
        const description = interaction.fields.getTextInputValue('request_desc').trim();
        const budget = kind === 'PAID' ? interaction.fields.getTextInputValue('budget').trim() : null;
        const other = interaction.fields.getTextInputValue('other').trim();
        if (!service || !description || (kind === 'PAID' && !budget)) {
            throw new Error('Vui lòng điền đầy đủ các trường bắt buộc.');
        }

        const channelKey = kind === 'PAID' ? 'requestPaid' : 'requestFree';
        const channelId = await getManagedChannelId(channelKey);
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased()) throw new Error('Không tìm thấy kênh request đích.');

        const request = await createCommunityRequest({
            client,
            channel: channel as TextChannel,
            requester: interaction.user,
            kind,
            service,
            description,
            budget,
            other,
            skill: isSkillKey(skill) ? skill : null
        });
        await interaction.editReply(`${config.ui.emojis.success} Đã tạo request #${request.id} tại <#${channelId}>.`).catch(() => {});
    } catch (error: any) {
        await interaction.editReply(`${config.ui.emojis.error} ${error?.message || 'Không thể tạo request. Vui lòng thử lại.'}`).catch(() => {});
    }
}

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

        await safeInteractionReply(interaction, {
            content: `${config.ui.emojis.error} Không mở được form. Vui lòng bấm lại sau vài giây.`,
            flags: MessageFlags.Ephemeral
        });
    }
}

// Skill picker shown before the request modal (modals cannot hold select menus).
// customId carries the request kind so the follow-up select knows which modal to open.
function skillSelectRow(kind: 'paid' | 'free') {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`skill_select_${kind}`)
            .setPlaceholder('Chọn lĩnh vực kỹ năng để định tuyến...')
            .addOptions(config.skills.map(s => ({ label: s.label, value: s.key })))
    );
}

function buildRequestModal(kind: 'PAID' | 'FREE', skill: string) {
    // skill is embedded in the modal customId so the submit handler can read it
    // (modal fields can't carry a hidden value).
    const modal = new ModalBuilder()
        .setCustomId(`request${kind === 'PAID' ? 'paid' : 'free'}_modal_${skill}`)
        .setTitle(kind === 'PAID' ? 'Yêu Cầu Có Phí (Paid)' : 'Yêu Cầu Giúp Đỡ (Free)');
    const s = new TextInputBuilder().setCustomId('service').setLabel(kind === 'PAID' ? 'Dịch vụ cần?' : 'Việc cần giúp?').setStyle(TextInputStyle.Short).setRequired(true);
    const r = new TextInputBuilder().setCustomId('request_desc').setLabel('Chi tiết yêu cầu').setStyle(TextInputStyle.Paragraph).setRequired(true);
    const o = new TextInputBuilder().setCustomId('other').setLabel('Liên hệ/Khác').setStyle(TextInputStyle.Paragraph).setRequired(false);
    const rows = [
        new ActionRowBuilder<TextInputBuilder>().addComponents(s),
        new ActionRowBuilder<TextInputBuilder>().addComponents(r)
    ];
    if (kind === 'PAID') {
        const b = new TextInputBuilder().setCustomId('budget').setLabel('Ngân sách (Ví dụ: 1M)').setStyle(TextInputStyle.Short).setRequired(true);
        rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(b));
    }
    rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(o));
    modal.addComponents(...rows);
    return modal;
}

export default {
    name: Events.InteractionCreate,
    once: false,
    async execute(interaction: Interaction, client: any) {
        if (interaction.isChatInputCommand()) {
            const startedAt = Date.now();
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
                    await safeInteractionReply(interaction, { content, flags: MessageFlags.Ephemeral });
                }
                return;
            }
            let expectedChannel = null;

            if (cmdName === 'portfolio') expectedChannel = config.channels.portfolio;
            const managedChannels = await getManagedChannelIds();

            if (expectedChannel && interaction.channelId !== expectedChannel) {
                return safeInteractionReply(interaction, { content: `${config.ui.emojis.error} Lệnh \`/${cmdName}\` chỉ được phép sử dụng trong kênh <#${expectedChannel}>.`, flags: MessageFlags.Ephemeral });
            }

            const restrictedChannels = [
                managedChannels.requestPaid,
                managedChannels.requestFree,
                config.channels.portfolio,
                config.channels.share,
                config.channels.showcase,
                managedChannels.serverAds
            ];

            if (!expectedChannel && cmdName !== 'panel' && restrictedChannels.includes(interaction.channelId)) {
                return safeInteractionReply(interaction, { content: `${config.ui.emojis.error} Không được phép dùng lệnh \`/${cmdName}\` ở kênh này để tránh trôi tin nhắn giao dịch!`, flags: MessageFlags.Ephemeral });
            }

            try {
                await command.execute(interaction);
                const elapsed = Date.now() - startedAt;
                if (elapsed > 2500) console.warn(`[InteractionSlow] /${interaction.commandName} took ${elapsed}ms`);
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
                await safeInteractionReply(interaction, { content, flags: MessageFlags.Ephemeral });
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
                    await safeInteractionReply(interaction, { content: `${config.ui.emojis.error} Preview này đã hết hạn hoặc không phải của bạn.`, flags: MessageFlags.Ephemeral });
                    return;
                }

                if (type === 'cancel') {
                    takePendingAnnouncement(id);
                    return await interaction.update({ content: 'Đã hủy thông báo.', embeds: [], components: [] }).catch(() => {});
                }

                try {
                    const data = getPendingAnnouncement(id);
                    if (!data) throw new Error('Preview expired.');
                    const message = await sendAnnouncement(client, data);
                    takePendingAnnouncement(id);
                    return await interaction.update({
                        content: `${config.ui.emojis.success} Đã gửi thông báo tại <#${message.channelId}>.`,
                        embeds: [],
                        components: []
                    }).catch(() => {});
                } catch (error: any) {
                    await safeInteractionReply(interaction, { content: `${config.ui.emojis.error} ${error?.message || 'Không gửi được thông báo.'}`, flags: MessageFlags.Ephemeral });
                    return;
                }
            }

            if (action === 'music') {
                if (!interaction.guildId) {
                    await safeInteractionReply(interaction, { content: 'Chỉ dùng music trong server.', flags: MessageFlags.Ephemeral });
                    return;
                }
                const type = part[1];
                const acknowledged = await safeDeferUpdate(interaction);
                if (!acknowledged) return;
                try {
                    await controlMusic(interaction.client, interaction.guildId, interaction.member as GuildMember, type);
                    return await interaction.editReply(musicPanel(interaction.client, interaction.guildId)).catch(() => {});
                } catch (error: any) {
                    await safeInteractionReply(interaction, { content: `${config.ui.emojis.error} ${error?.message || 'Music error.'}`, flags: MessageFlags.Ephemeral });
                    return;
                }
            }

            if (action === 'giveaway') {
                const type = part[1];

                if (type === 'panel' && part[2] === 'create') {
                    const modal = new ModalBuilder().setCustomId('giveaway_quick_modal').setTitle('Tạo Giveaway Nhanh');
                    const title = new TextInputBuilder().setCustomId('title').setLabel('Tiêu đề').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true);
                    const prize = new TextInputBuilder().setCustomId('prize').setLabel('Phần thưởng').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(true);
                    const duration = new TextInputBuilder().setCustomId('duration').setLabel('Thời lượng (VD: 30m, 2h, 3d)').setStyle(TextInputStyle.Short).setRequired(true);
                    const winners = new TextInputBuilder().setCustomId('winners').setLabel('Số winner').setStyle(TextInputStyle.Short).setRequired(true);
                    const description = new TextInputBuilder().setCustomId('description').setLabel('Mô tả').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false);
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
                    const acknowledged = await safeDeferEphemeral(interaction);
                    if (!acknowledged) return;
                    if (type === 'join') {
                        if (!interaction.guild) throw new Error('Chỉ dùng giveaway trong server.');
                        const created = await joinGiveaway(client, interaction.guild, giveawayId, interaction.user.id);
                        return interaction.editReply({
                            content: created
                                ? `${config.ui.emojis.success} Đã tham gia giveaway #${giveawayId}. Chúc bạn may mắn.`
                                : `${config.ui.emojis.note} Bạn đã có trong danh sách giveaway #${giveawayId} rồi.`
                        }).catch(() => {});
                    }
                    if (type === 'leave') {
                        const removed = await leaveGiveaway(client, giveawayId, interaction.user.id);
                        return interaction.editReply({
                            content: removed
                                ? `${config.ui.emojis.success} Đã rời giveaway #${giveawayId}.`
                                : `${config.ui.emojis.note} Bạn chưa tham gia giveaway #${giveawayId}.`
                        }).catch(() => {});
                    }
                    if (type === 'participants') {
                        const [entries, total] = await Promise.all([
                            prisma.giveawayEntry.findMany({ where: { giveawayId }, orderBy: { joinedAt: 'asc' }, take: 50 }),
                            prisma.giveawayEntry.count({ where: { giveawayId } })
                        ]);
                        const lines = entries.map((entry, index) => `**${index + 1}.** <@${entry.userId}>`).join('\n') || 'Chưa có ai tham gia.';
                        return interaction.editReply({
                            embeds: [new EmbedBuilder()
                                .setColor('#f1c40f')
                                .setTitle(`Danh sách tham gia #${giveawayId}`)
                                .setDescription(lines)
                                .setFooter({ text: `Hiển thị ${entries.length}/${total} người tham gia.` })]
                        }).catch(() => {});
                    }
                } catch (error: any) {
                    return interaction.editReply({
                        content: `${config.ui.emojis.error} ${error?.message || 'Không xử lý được giveaway. Vui lòng thử lại sau.'}`
                    }).catch(() => {});
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
                    // Ack first — optOutShowcase does DB work plus an awaited admin
                    // log send, which can exceed the 3s interaction window.
                    const acknowledged = await safeDeferUpdate(interaction);
                    if (!acknowledged) return;
                    const ok = await optOutShowcase(client, messageId, interaction.user);
                    if (!ok) {
                        return safeInteractionReply(interaction, { content: `${config.ui.emojis.error} Không thể opt out bài showcase này.`, flags: MessageFlags.Ephemeral });
                    }
                    const rendered = await renderShowcaseControl(client, messageId, interaction.user);
                    if (rendered) {
                        await interaction.editReply(rendered).catch(() => {});
                    } else {
                        await safeInteractionReply(interaction, { content: `${config.ui.emojis.success} Đã opt out showcase.`, flags: MessageFlags.Ephemeral });
                    }
                }
                return;
            }

            if (action === 'request') {
                const type = part[1];
                const requestId = Number(part[2]);
                if (!Number.isFinite(requestId)) return;

                if (type === 'rate') {
                    const acknowledged = await safeDeferUpdate(interaction);
                    if (!acknowledged) return;
                    const rating = Math.max(1, Math.min(5, Number(part[3]) || 1));
                    try {
                        const text = await rateRequest(interaction.client, interaction.guildId, requestId, interaction.user.id, rating);
                        return await interaction.editReply({ content: `${config.ui.emojis.success} ${text}`, embeds: [], components: [] }).catch(() => {});
                    } catch (error: any) {
                        if (error?.code === REQUEST_ALREADY_RATED) {
                            await interaction.editReply({ components: [] }).catch(() => {});
                        }
                        await safeInteractionReply(interaction, { content: `${config.ui.emojis.error} ${error?.message || 'Request error.'}`, flags: MessageFlags.Ephemeral });
                        return;
                    }
                }

                if (!['claim', 'complete', 'close'].includes(type)) return;
                const acknowledged = await safeDeferEphemeral(interaction);
                if (!acknowledged) return;
                try {
                    if (type === 'claim') {
                        const text = await claimRequest(interaction.client, interaction.guildId, requestId, interaction.user);
                        return await interaction.editReply({ content: `${config.ui.emojis.success} ${text}` }).catch(() => {});
                    }
                    if (type === 'complete') {
                        const text = await completeRequest(
                            interaction.client,
                            interaction.guildId,
                            requestId,
                            interaction.user.id,
                            interaction.memberPermissions?.has('Administrator') ?? false
                        );
                        return await interaction.editReply({ content: `${config.ui.emojis.success} ${text}` }).catch(() => {});
                    }
                    if (type === 'close') {
                        const text = await closeRequest(
                            interaction.client,
                            interaction.guildId,
                            requestId,
                            interaction.user.id,
                            interaction.memberPermissions?.has('Administrator') ?? false
                        );
                        return await interaction.editReply({ content: `${config.ui.emojis.success} ${text}` }).catch(() => {});
                    }
                } catch (error: any) {
                    return await interaction.editReply({ content: `${config.ui.emojis.error} ${error?.message || 'Request error.'}` }).catch(() => {});
                }
                return;
            }

            if (action === 'panel') {
                const type = part[1];

                if (type === 'paid' || type === 'free') {
                    // Modals cannot contain select menus, so pick the skill FIRST via an
                    // ephemeral string-select; the modal opens after choosing (skill_select_<kind>).
                    await safeInteractionReply(interaction, {
                        content: `${config.ui.emojis.service} Chọn nhóm kỹ năng cho yêu cầu này để Stella ping đúng freelancer:`,
                        components: [skillSelectRow(type)],
                        flags: MessageFlags.Ephemeral
                    });
                }
                else if (type === 'port') {
                    const modal = new ModalBuilder().setCustomId('portfolio_modal').setTitle('Quảng Bá Bản Thân');
                    const n = new TextInputBuilder().setCustomId('name').setLabel('Tên/Tuổi').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true);
                    const e = new TextInputBuilder().setCustomId('experience').setLabel('Kinh nghiệm').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true);
                    const s = new TextInputBuilder().setCustomId('service').setLabel('Dịch vụ').setStyle(TextInputStyle.Short).setMaxLength(500).setRequired(true);
                    const p = new TextInputBuilder().setCustomId('portfolio_link').setLabel('Link Sản Phẩm').setStyle(TextInputStyle.Short).setMaxLength(1000).setRequired(true);
                    const c = new TextInputBuilder().setCustomId('contact').setLabel('Liên hệ').setStyle(TextInputStyle.Short).setMaxLength(500).setRequired(true);
                    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(n), new ActionRowBuilder<TextInputBuilder>().addComponents(e), new ActionRowBuilder<TextInputBuilder>().addComponents(s), new ActionRowBuilder<TextInputBuilder>().addComponents(p), new ActionRowBuilder<TextInputBuilder>().addComponents(c));
                    await showModalSafely(interaction, modal, client, 'panel_portfolio');
                }
                else if (type === 'serverads') {
                    const modal = new ModalBuilder().setCustomId('serverads_modal').setTitle('Đăng Server Ads');
                    const name = new TextInputBuilder().setCustomId('name').setLabel('Tên server').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true);
                    const desc = new TextInputBuilder().setCustomId('description').setLabel('Mô tả ngắn').setStyle(TextInputStyle.Paragraph).setMaxLength(800).setRequired(false);
                    const link = new TextInputBuilder().setCustomId('link').setLabel('Link Discord').setStyle(TextInputStyle.Short).setMaxLength(1000).setRequired(true);
                    const ip = new TextInputBuilder().setCustomId('ip').setLabel('IP Minecraft (optional)').setStyle(TextInputStyle.Short).setMaxLength(120).setRequired(false);
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

            // Verified-freelancer approval buttons (admin-gated). customId:
            // verify_approve_<userId> / verify_reject_<userId>. The permission
            // check is the FIRST line here (fail-closed), not channel visibility.
            if (action === 'verify') {
                if (!interaction.memberPermissions?.has('Administrator')) {
                    await interaction.reply({ content: `${config.ui.emojis.error} Chỉ admin mới duyệt Verified Freelancer.`, flags: MessageFlags.Ephemeral });
                    return;
                }
                const decision = part[1]; // 'approve' | 'reject'
                const targetId = part[2];
                // Ack first: grantVerifiedRole does a member fetch + role add that can
                // exceed the 3s window on a slow gateway.
                await safeDeferUpdate(interaction);
                if (decision === 'approve' && interaction.guild) {
                    const ok = await grantVerifiedRole(interaction.guild, targetId);
                    await interaction.editReply({
                        content: ok ? `${config.ui.emojis.success} Đã cấp Verified Freelancer cho <@${targetId}> (duyệt bởi <@${interaction.user.id}>).` : `${config.ui.emojis.error} Không cấp được role (thiếu role hoặc thành viên đã rời).`,
                        components: []
                    }).catch(() => {});
                } else {
                    await interaction.editReply({
                        content: `${config.ui.emojis.close} Đã từ chối Verified Freelancer cho <@${targetId}> (bởi <@${interaction.user.id}>).`,
                        components: []
                    }).catch(() => {});
                }
                return;
            }

            // Facebook cross-post approval (admin-gated). customId:
            // fbpost_approve_<candidateId> / fbpost_reject_<candidateId>. The
            // permission check is the FIRST line (fail-closed), not channel visibility.
            if (action === 'fbpost') {
                if (!interaction.memberPermissions?.has('Administrator')) {
                    await interaction.reply({ content: `${config.ui.emojis.error} Chỉ admin mới duyệt cross-post.`, flags: MessageFlags.Ephemeral });
                    return;
                }
                const decision = part[1]; // 'approve' | 'reject'
                const candidateId = Number(part[2]);
                if (!Number.isInteger(candidateId)) return;
                // Ack FIRST: publishing round-trips to the FB Graph API (image fetch
                // is routinely multiple seconds) and would blow the 3s interaction
                // window, dropping the mod's feedback. Defer, then edit.
                await safeDeferUpdate(interaction);
                if (decision === 'approve') {
                    const result = await approveCrossPost(client, candidateId);
                    const msg = result === 'published' ? `${config.ui.emojis.success} Đã đăng lên Facebook.`
                        : result === 'already' ? `${config.ui.emojis.close} Bài này đã xử lý rồi.`
                        : result === 'disabled' ? `${config.ui.emojis.error} Cross-post đang tắt (thiếu token/cấu hình).`
                        : `${config.ui.emojis.error} Đăng thất bại — xem admin log (đã trả về PENDING để thử lại).`;
                    // Keep Approve/Reject buttons ONLY when the row is retryable (failed
                    // → restored to PENDING); strip them on terminal outcomes.
                    const keepButtons = result === 'failed';
                    await interaction.editReply({
                        content: msg,
                        embeds: interaction.message.embeds,
                        components: keepButtons ? interaction.message.components : []
                    }).catch(() => {});
                } else {
                    await rejectCrossPost(candidateId);
                    await interaction.editReply({ content: `${config.ui.emojis.close} Đã bỏ qua cross-post (bởi <@${interaction.user.id}>).`, embeds: interaction.message.embeds, components: [] }).catch(() => {});
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

                try {
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

                        // Repost BEFORE deleting: if the send fails (e.g. missing
                        // permission), the original post must survive instead of
                        // being destroyed with nothing to replace it.
                        await (interaction.channel as TextChannel).send({
                            content: oldContent,
                            embeds: [oldEmbed],
                            components: oldComponents as any
                        });
                        await interaction.message.delete().catch(() => {});

                        await interaction.reply({ content: `${config.ui.emojis.bump} Đã bump bài lên top!`, flags: MessageFlags.Ephemeral });
                    }
                } catch (error) {
                    console.error('[interaction] close/bump failed:', error);
                    await safeInteractionReply(interaction, { content: `${config.ui.emojis.error} Không thể xử lý bài đăng. Vui lòng thử lại.`, flags: MessageFlags.Ephemeral });
                }
                return;
            }
        } else if (interaction.isStringSelectMenu()) {
            if (interaction.customId.startsWith('showcase_tag_')) {
                const messageId = interaction.customId.replace('showcase_tag_', '');
                const tagName = interaction.values[0];
                // Ack first — updateShowcaseTag does DB work plus an awaited admin
                // log send, which can exceed the 3s interaction window.
                const acknowledged = await safeDeferUpdate(interaction);
                if (!acknowledged) return;
                const ok = await updateShowcaseTag(client, messageId, interaction.user, tagName);
                if (!ok) {
                    return safeInteractionReply(interaction, { content: `${config.ui.emojis.error} Không thể đổi tag showcase này.`, flags: MessageFlags.Ephemeral });
                }
                const rendered = await renderShowcaseControl(client, messageId, interaction.user);
                if (rendered) await interaction.editReply(rendered).catch(() => {});
                else await safeInteractionReply(interaction, { content: `${config.ui.emojis.success} Đã đổi tag thành ${tagName}.`, flags: MessageFlags.Ephemeral });
            }
            // Skill picked for a new request → open the create modal carrying the skill.
            else if (interaction.customId.startsWith('skill_select_')) {
                const kind = interaction.customId === 'skill_select_paid' ? 'PAID' : 'FREE';
                const skill = interaction.values[0];
                await showModalSafely(interaction, buildRequestModal(kind, skill), client, `skill_select_${kind}`);
            }
            // Self-serve skill-role toggle (multi-select). Add/remove each chosen role.
            else if (interaction.customId === 'skillrole_toggle') {
                if (!interaction.guild) return;
                const results: string[] = [];
                for (const key of interaction.values) {
                    const state = await toggleSkillRole(interaction.guild, interaction.user.id, key);
                    const meta = getSkillMeta(key);
                    if (state) results.push(`${state === 'added' ? '✅' : '❌'} ${meta?.label || key}`);
                }
                await safeInteractionReply(interaction, {
                    content: results.length ? results.join('\n') : `${config.ui.emojis.error} Không cập nhật được role kỹ năng.`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }
        else if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('requestpaid_modal')) {
                const skill = interaction.customId.replace('requestpaid_modal_', '').replace('requestpaid_modal', '') || null;
                await createRequestFromModal(interaction, interaction.client, 'PAID', skill);

            } else if (interaction.customId.startsWith('requestfree_modal')) {
                const skill = interaction.customId.replace('requestfree_modal_', '').replace('requestfree_modal', '') || null;
                await createRequestFromModal(interaction, interaction.client, 'FREE', skill);

            } else if (interaction.customId === 'portfolio_modal') {
                const acknowledged = await safeDeferEphemeral(interaction);
                if (!acknowledged) return;
                try {
                    const n = interaction.fields.getTextInputValue('name');
                    const e = interaction.fields.getTextInputValue('experience');
                    const s = interaction.fields.getTextInputValue('service');
                    const p = interaction.fields.getTextInputValue('portfolio_link');
                    const c = interaction.fields.getTextInputValue('contact');
                    const embed = buildPortfolioEmbed(interaction.user, n, e, s, p, c);
                    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`bump_${interaction.user.id}`).setLabel('Bump Bài').setStyle(ButtonStyle.Primary).setEmoji(config.ui.emojis.bump));
                    const targetChan = interaction.client.channels.cache.get(config.channels.portfolio) as TextChannel | undefined;
                    if (!targetChan?.isTextBased()) throw new Error('Không tìm thấy kênh portfolio đích.');
                    await targetChan.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [row] });
                    await interaction.editReply(`${config.ui.emojis.success} Đã đăng portfolio thành công tại <#${config.channels.portfolio}>!`).catch(() => {});

                    // First portfolio → send a mod-approval prompt for the Verified
                    // Freelancer role. Gated by markFirstPortfolio so it fires once.
                    if (await markFirstPortfolio(interaction.user.id)) {
                        const approveRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                            new ButtonBuilder().setCustomId(`verify_approve_${interaction.user.id}`).setLabel('Duyệt Verified').setStyle(ButtonStyle.Success).setEmoji(config.ui.emojis.success),
                            new ButtonBuilder().setCustomId(`verify_reject_${interaction.user.id}`).setLabel('Bỏ qua').setStyle(ButtonStyle.Secondary)
                        );
                        await sendAdminLog(interaction.client, {
                            title: 'Verified Freelancer — chờ duyệt',
                            color: '#57f287',
                            fields: [
                                { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                                { name: 'Dịch vụ', value: s.slice(0, 200), inline: true },
                                { name: 'Portfolio', value: p.slice(0, 300) }
                            ]
                        }).catch(() => {});
                        const botLog = await interaction.client.channels.fetch(config.channels.botLog).catch(() => null);
                        if (botLog?.isTextBased() && 'send' in botLog) {
                            await (botLog as TextChannel).send({
                                content: `Duyệt cấp role Verified Freelancer cho <@${interaction.user.id}>?`,
                                components: [approveRow],
                                allowedMentions: { parse: [] }
                            }).catch(() => {});
                        }
                    }
                } catch (error: any) {
                    await interaction.editReply(`${config.ui.emojis.error} ${error?.message || 'Không thể đăng portfolio. Vui lòng thử lại.'}`).catch(() => {});
                }
            }
            else if (interaction.customId.startsWith('showcasetitle_')) {
                const messageId = interaction.customId.replace('showcasetitle_', '');
                const title = interaction.fields.getTextInputValue('title');
                // Ack first — updateShowcaseTitle does DB work plus an awaited admin
                // log send, which can exceed the 3s interaction window.
                const acknowledged = await safeDeferEphemeral(interaction);
                if (!acknowledged) return;
                const ok = await updateShowcaseTitle(client, messageId, interaction.user, title);
                if (!ok) {
                    return await interaction.editReply({ content: `${config.ui.emojis.error} Không thể đổi title showcase này.` }).catch(() => {});
                }
                await interaction.editReply({ content: `${config.ui.emojis.success} Đã cập nhật title showcase.` }).catch(() => {});
            }
            else if (interaction.customId === 'serverads_modal') {
                const acknowledged = await safeDeferEphemeral(interaction);
                if (!acknowledged) return;
                try {
                    const serverAdsChannelId = await getManagedChannelId('serverAds');
                    const channel = await interaction.client.channels.fetch(serverAdsChannelId).catch(() => null);
                    if (!channel || !channel.isTextBased()) {
                        return await interaction.editReply(`${config.ui.emojis.error} Không tìm thấy kênh server-ads.`).catch(() => {});
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
                        return await interaction.editReply(`${config.ui.emojis.error} Server Ads cần có tên và link Discord/http hợp lệ.`).catch(() => {});
                    }

                    await publishServerAd(channel as TextChannel, interaction.user, input);
                    await interaction.editReply(`${config.ui.emojis.success} Đã đăng quảng cáo tại <#${serverAdsChannelId}>.`).catch(() => {});
                } catch (error: any) {
                    await interaction.editReply(`${config.ui.emojis.error} ${error?.message || 'Không thể đăng server ads. Vui lòng thử lại.'}`).catch(() => {});
                }
            }
            else if (interaction.customId === 'giveaway_quick_modal' || interaction.customId.startsWith('giveaway_create_modal_')) {
                const acknowledged = await safeDeferEphemeral(interaction);
                if (!acknowledged) return;
                try {
                    if (!interaction.memberPermissions?.has('Administrator')) {
                        return await interaction.editReply('Bạn cần quyền Administrator để tạo giveaway.').catch(() => {});
                    }
                    const draftId = interaction.customId.startsWith('giveaway_create_modal_')
                        ? interaction.customId.replace('giveaway_create_modal_', '')
                        : null;
                    const draft = draftId ? takeGiveawayDraft(draftId, interaction.user.id) : null;
                    if (draftId && !draft) {
                        return await interaction.editReply(`${config.ui.emojis.error} Form giveaway đã hết hạn. Vui lòng dùng lại \`/giveaway create\`.`).catch(() => {});
                    }
                    const channel = draft?.channelId
                        ? await interaction.client.channels.fetch(draft.channelId).catch(() => null) as TextChannel | null
                        : interaction.channel as TextChannel;
                    if (!channel?.isTextBased()) return await interaction.editReply('Kênh hiện tại không hợp lệ.').catch(() => {});

                    const durationMs = parseDuration(interaction.fields.getTextInputValue('duration'));
                    const winners = Math.max(1, Math.min(20, Number(interaction.fields.getTextInputValue('winners')) || 1));
                    const giveaway = await createGiveaway(client, {
                        channel,
                        title: interaction.fields.getTextInputValue('title'),
                        prize: interaction.fields.getTextInputValue('prize'),
                        description: interaction.fields.getTextInputValue('description') || 'Nhấn nút bên dưới để tham gia giveaway.',
                        durationMs,
                        winnersCount: winners,
                        hostId: draft?.hostId || interaction.user.id,
                        pingRoleId: draft?.pingRoleId || null,
                        requiredRoleId: draft?.requiredRoleId || null,
                        minLevel: draft?.minLevel || null,
                        minScoin: draft?.minScoin || null,
                        entryCost: draft?.entryCost || 0,
                        rewardType: draft?.rewardType || 'contact_host',
                        rewardSecret: draft?.rewardSecret || null,
                        publicMediaUrl: draft?.publicMediaUrl || GIVEAWAY_BANNER,
                        createdBy: interaction.user.id
                    });
                    await interaction.editReply(`${config.ui.emojis.success} Đã tạo giveaway #${giveaway.id} tại <#${channel.id}>.`).catch(() => {});
                } catch (error: any) {
                    await interaction.editReply(`${config.ui.emojis.error} ${error?.message || 'Không thể tạo giveaway. Vui lòng thử lại.'}`).catch(() => {});
                }
            }
        }
    }
};
