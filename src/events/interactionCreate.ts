import { Events, Interaction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, GuildMember, PermissionFlagsBits, LabelBuilder, RadioGroupBuilder, FileUploadBuilder } from 'discord.js';
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
import { handleMusicComponent } from '../systems/music';
import { claimRequest, closeRequest, completeRequest, createCommunityRequest, rateRequest, refreshRequestMessage, releaseRequest, REQUEST_ALREADY_RATED } from '../systems/requestManager';
import { applyRequestEdit, buildRequestEditModal, parseRequestEditId } from '../systems/request/request-edit';
import { isSkillKey, toggleSkillRole, getSkillMeta } from '../systems/skillRoleManager';
import { budgetHintText, parseBudgetInput } from '../systems/request/budget-parser';
import { serializeReferenceUrls, validateReferenceImages } from '../systems/request/reference-image-validator';
import { markFirstPortfolio, grantVerifiedRole } from '../systems/freelancerManager';
import {
    buildPortfolioModal,
    parsePortfolioEditId,
    portfolioPostButtons,
    readPortfolioEmbed,
    PORTFOLIO_EDIT_PREFIX
} from '../systems/portfolio/portfolio-post-editor';
import { approveCrossPost, rejectCrossPost } from '../systems/facebookCrossPostManager';
import { safeDeferEphemeral, safeDeferUpdate, safeInteractionReply } from '../utils/interaction-safe-reply';
import { markRolePicked } from '../systems/invite/invite-verification';
import { buildInvitedListPayload } from '../systems/invite/invite-embeds';
import { buildOddsReply } from '../systems/invite/invite-giveaway-weight';
import { buildEditDiffReply, buildEditHistoryReply } from '../systems/logs/message-log-embeds';
import { getRecentByAuthor } from '../systems/logs/message-mirror';
import { handleAutomodButton } from '../systems/automod/automod-alert';
import { handleRoleMenuComponent } from '../systems/rolemenu/rolemenu-handler';
import { handleTempVoiceComponent } from '../systems/tempvoice/tempvoice-controls';
import { handleJoinRiskButton } from '../systems/moderation/join-risk-alert';
import { handlePortfolioPageButton, isPortfolioPageButton } from '../systems/showcase/portfolio-view';
import { FREELANCER_EDIT_MODAL, handleFreelancerEditModal } from '../systems/freelancer/freelancer-profile-view';
import { handleTicketComponent } from '../systems/ticket/ticket-interactions';

// Đọc một trường không bắt buộc của modal. getField() NÉM lỗi khi payload không có
// trường đó (người dùng không chọn/không gửi gì), nên không thể gọi trực tiếp.
function readOptionalModalField<T>(read: () => T): T | null {
    try {
        return read();
    } catch {
        return null;
    }
}

async function createRequestFromModal(interaction: any, client: any, kind: 'PAID' | 'FREE') {
    const acknowledged = await safeDeferEphemeral(interaction);
    if (!acknowledged) return;

    try {
        // Kỹ năng nay nằm TRONG modal (Radio Group) thay vì một bước chọn riêng trước đó.
        const skill = readOptionalModalField(() => interaction.fields.getRadioGroup('skill'));
        const service = interaction.fields.getTextInputValue('service').trim();
        const description = interaction.fields.getTextInputValue('request_desc').trim();
        const budgetRaw = kind === 'PAID' ? interaction.fields.getTextInputValue('budget').trim() : null;
        const other = kind === 'FREE'
            ? (readOptionalModalField(() => interaction.fields.getTextInputValue('other')) || '').trim()
            : null;
        if (!service || !description || (kind === 'PAID' && !budgetRaw)) {
            throw new Error('Vui lòng điền đầy đủ các trường bắt buộc.');
        }

        // Giá phải ra được một con số. Đây là lý do tồn tại của cả phase này: chuỗi tự do
        // thì không sort, không lọc tầm giá, không thống kê được. Không hiểu được thì bắt
        // ghi lại chứ không lưu null ngầm — khoảng giá thì ghi vào phần chi tiết.
        const parsedBudget = kind === 'PAID' ? parseBudgetInput(budgetRaw) : null;
        if (kind === 'PAID' && !parsedBudget) {
            throw new Error(`Ngân sách phải là một số cụ thể. ${budgetHintText()}`);
        }

        // file_types của Discord chỉ là gợi ý phía client — kiểm lại ở đây.
        const uploaded = readOptionalModalField(() => interaction.fields.getUploadedFiles('refs'));
        const references = validateReferenceImages(uploaded);
        if (references.error) throw new Error(references.error);

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
            budget: budgetRaw,
            budgetAmount: parsedBudget?.amount ?? null,
            budgetCurrency: parsedBudget?.currency ?? null,
            referenceUrls: serializeReferenceUrls(references.urls),
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

// Form đặt đơn: MỘT bước duy nhất.
//
// Trước đây phải bấm nút → chọn kỹ năng ở select menu → mới mở modal, vì hồi đó modal
// không chứa được select. discord.js 14.27 có Radio Group (component type 21) dùng được
// trong modal nên bước chọn riêng đã bỏ.
//
// Modal chỉ nhận TỐI ĐA 5 component ở tầng ngoài ("Between 1 and 5 (inclusive) components
// that make up the modal"). Đó là lý do đơn PAID không có ô "Liên hệ/Khác" riêng: 5 chỗ đã
// dùng cho lĩnh vực, dịch vụ, chi tiết, ngân sách, ảnh tham khảo. Liên hệ ghi vào phần chi
// tiết, và khi đơn có người nhận thì đã có kênh riêng để nói chuyện.
function buildRequestModal(kind: 'PAID' | 'FREE') {
    const modal = new ModalBuilder()
        .setCustomId(`request${kind === 'PAID' ? 'paid' : 'free'}_modal`)
        .setTitle(kind === 'PAID' ? 'Yêu Cầu Có Phí (Paid)' : 'Yêu Cầu Giúp Đỡ (Free)');

    const skill = new LabelBuilder()
        .setLabel('Lĩnh vực')
        .setDescription('Stella chỉ ping đúng nhóm nhận việc này, không ping cả server.')
        .setRadioGroupComponent(
            new RadioGroupBuilder()
                .setCustomId('skill')
                .setRequired(true)
                .setOptions(config.skills.map(s => ({ label: s.label, value: s.key })))
        );

    const service = new LabelBuilder()
        .setLabel(kind === 'PAID' ? 'Dịch vụ cần?' : 'Việc cần giúp?')
        .setTextInputComponent(
            new TextInputBuilder().setCustomId('service').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(true)
        );

    const description = new LabelBuilder()
        .setLabel('Chi tiết yêu cầu')
        .setDescription('Ghi cả hạn mong muốn và cách liên hệ nếu có.')
        .setTextInputComponent(
            new TextInputBuilder().setCustomId('request_desc').setStyle(TextInputStyle.Paragraph).setMaxLength(2000).setRequired(true)
        );

    const references = new LabelBuilder()
        .setLabel('Ảnh tham khảo')
        .setDescription(`Không bắt buộc, tối đa ${config.request.maxReferenceFiles} ảnh.`)
        .setFileUploadComponent(
            // file_types phải đi qua constructor — FileUploadBuilder KHÔNG có setFileTypes.
            new FileUploadBuilder({
                custom_id: 'refs',
                max_values: config.request.maxReferenceFiles,
                required: false,
                file_types: ['image']
            })
        );

    const fourth = kind === 'PAID'
        ? new LabelBuilder()
            .setLabel('Ngân sách')
            .setDescription(budgetHintText())
            .setTextInputComponent(
                new TextInputBuilder().setCustomId('budget').setStyle(TextInputStyle.Short).setMaxLength(50).setRequired(true)
            )
        : new LabelBuilder()
            .setLabel('Liên hệ / Khác')
            .setTextInputComponent(
                new TextInputBuilder().setCustomId('other').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false)
            );

    modal.addLabelComponents(skill, service, description, fourth, references);
    return modal;
}

export default {
    name: Events.InteractionCreate,
    once: false,
    async execute(interaction: Interaction, client: any) {
        // Panel phòng voice tạm dùng cả nút, modal và user-select. Bắt trước router
        // chính để không phải nhân ba nhánh cho cùng một tính năng.
        if (
            (interaction.isButton() || interaction.isModalSubmit() || interaction.isUserSelectMenu()) &&
            interaction.customId.startsWith('tvc_')
        ) {
            await handleTempVoiceComponent(interaction);
            return;
        }

        // Ticket dùng cả nút và modal — cùng lý do gộp như panel voice ở trên.
        if (
            (interaction.isButton() || interaction.isModalSubmit()) &&
            interaction.customId.startsWith('ticket_')
        ) {
            await handleTicketComponent(interaction);
            return;
        }

        // Autocomplete phải trả lời trong 3s và không được defer, nên xử lý trước
        // mọi nhánh khác; lệnh không khai báo hàm này thì bỏ qua im lặng.
        if (interaction.isAutocomplete()) {
            const autocompleteCommand = client.commands.get(interaction.commandName);
            if (!autocompleteCommand?.autocomplete) return;
            try {
                await autocompleteCommand.autocomplete(interaction);
            } catch (error) {
                console.error(`[autocomplete] /${interaction.commandName} failed:`, error);
                await interaction.respond([]).catch(() => {});
            }
            return;
        }

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

            // Music: custom_id dang "music:<action>" (moi) va "music_<action>" (cu).
            if (interaction.customId.startsWith('music')) {
                await handleMusicComponent(interaction);
                return;
            }

            // Nút xử của mod trên cảnh báo automod: automod_<action>_<userId>.
            if (action === 'automod') {
                await handleAutomodButton(interaction);
                return;
            }

            // Role menu / cổng verify: rolemenu_btn_<menuId>_<roleId>.
            if (action === 'rolemenu') {
                await handleRoleMenuComponent(interaction);
                return;
            }

            // Nút Kick/Ban trên cảnh báo acc đáng ngờ lúc join.
            if (action === 'joinrisk') {
                await handleJoinRiskButton(interaction);
                return;
            }

            // Phân trang /portfolio: pfolio_<authorId>_<page>. Tiền tố riêng để không đụng
            // luồng portfolio cũ (`portfolio_modal`, `bump_<userId>`).
            if (isPortfolioPageButton(interaction.customId)) {
                await handlePortfolioPageButton(interaction);
                return;
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
                        const [giveaway, entries, total] = await Promise.all([
                            prisma.giveaway.findUnique({ where: { id: giveawayId }, select: { inviteBonusMode: true } }),
                            prisma.giveawayEntry.findMany({ where: { giveawayId }, orderBy: { joinedAt: 'asc' }, take: 50 }),
                            prisma.giveawayEntry.count({ where: { giveawayId } })
                        ]);
                        // Giveaway có ưu tiên theo lượt mời thì hiện luôn số vé và xếp theo
                        // vé giảm dần — nhìn là biết mình đang đứng đâu.
                        const weighted = giveaway?.inviteBonusMode && giveaway.inviteBonusMode !== 'none';
                        const rows = weighted ? [...entries].sort((a, b) => b.entries - a.entries) : entries;
                        const lines = rows
                            .map((entry, index) => `**${index + 1}.** <@${entry.userId}>${weighted ? ` · ${entry.entries} vé` : ''}`)
                            .join('\n') || 'Chưa có ai tham gia.';
                        return interaction.editReply({
                            embeds: [new EmbedBuilder()
                                .setColor('#f1c40f')
                                .setTitle(`Danh sách tham gia #${giveawayId}`)
                                .setDescription(lines)
                                .setFooter({ text: `Hiển thị ${rows.length}/${total} người tham gia.` })]
                        }).catch(() => {});
                    }
                    if (type === 'odds') {
                        return interaction.editReply(await buildOddsReply(giveawayId, interaction.user.id)).catch(() => {});
                    }
                } catch (error: any) {
                    return interaction.editReply({
                        content: `${config.ui.emojis.error} ${error?.message || 'Không xử lý được giveaway. Vui lòng thử lại sau.'}`
                    }).catch(() => {});
                }
                return;
            }

            // Danh sách người đã mời, phân trang. Ai cũng xem được của người khác:
            // đây là dữ liệu công khai như bảng xếp hạng, không phải thông tin riêng.
            if (action === 'invite' && part[1] === 'list') {
                const targetId = part[2];
                const page = Number(part[3]) || 0;
                const acknowledged = await safeDeferEphemeral(interaction);
                if (!acknowledged) return;
                return interaction.editReply(await buildInvitedListPayload(targetId, page)).catch(() => {});
            }

            // Log tin nhắn: xem đoạn đã sửa / toàn bộ lịch sử sửa. Chỉ admin — nội dung
            // tin nhắn cũ của người khác không phải thứ để ai cũng tra được.
            if (action === 'msglog') {
                if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
                    await safeInteractionReply(interaction, {
                        content: `${config.ui.emojis.error} Chỉ Administrator xem được lịch sử tin nhắn.`,
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }
                const acknowledged = await safeDeferEphemeral(interaction);
                if (!acknowledged) return;
                const messageId = part[2];
                const payload = part[1] === 'diff'
                    ? await buildEditDiffReply(messageId)
                    : await buildEditHistoryReply(messageId);
                return interaction.editReply(payload).catch(() => {});
            }

            // 10 tin gần nhất của một người, dựng từ bản sao tin nhắn. Chỉ mod.
            if (action === 'inspect' && part[1] === 'recent') {
                if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
                    await safeInteractionReply(interaction, {
                        content: `${config.ui.emojis.error} Chỉ mod xem được.`,
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }
                const acknowledged = await safeDeferEphemeral(interaction);
                if (!acknowledged) return;
                const rows = await getRecentByAuthor(part[2], 10);
                const lines = rows.length
                    ? rows.map(row =>
                        `<t:${Math.floor(row.createdAt.getTime() / 1000)}:t> <#${row.channelId}>` +
                        `${row.deletedAt ? ' *(đã xoá)*' : ''}${row.editCount ? ` *(sửa ${row.editCount}×)*` : ''}\n` +
                        `> ${row.content.slice(0, 200) || '*không có văn bản*'}`
                    ).join('\n')
                    : '*Không còn bản sao tin nhắn nào của người này.*';
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor('#3498db')
                        .setTitle('10 tin gần nhất')
                        .setDescription(`Của <@${part[2]}>\n\n${lines}`.slice(0, 4000))
                        .setFooter({ text: 'Chỉ trong thời gian còn giữ bản sao' })]
                }).catch(() => {});
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

                // Nút Sửa mở modal nên phải xử lý TRƯỚC mọi deferReply: đã ack thì không
                // showModal được nữa.
                if (type === 'edit') {
                    const request = await prisma.requestPost.findUnique({ where: { id: requestId } });
                    if (!request) {
                        await interaction.reply({ content: `${config.ui.emojis.error} Không tìm thấy đơn.`, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const isAdmin = interaction.memberPermissions?.has('Administrator') ?? false;
                    if (!isAdmin && request.requesterId !== interaction.user.id) {
                        await interaction.reply({ content: `${config.ui.emojis.error} Chỉ chủ đơn hoặc ban quản trị mới sửa được.`, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!['OPEN', 'CLAIMED'].includes(request.status)) {
                        await interaction.reply({ content: `${config.ui.emojis.error} Đơn đã xong hoặc đã đóng thì không sửa được nữa.`, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    await showModalSafely(interaction, buildRequestEditModal(request), client, 'request_edit');
                    return;
                }

                if (!['claim', 'complete', 'close', 'release'].includes(type)) return;
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
                    if (type === 'release') {
                        const text = await releaseRequest(
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
                    // Mở modal ngay từ nút. Kỹ năng chọn bằng Radio Group bên trong modal,
                    // không còn bước select riêng.
                    await showModalSafely(
                        interaction,
                        buildRequestModal(type === 'paid' ? 'PAID' : 'FREE'),
                        client,
                        `panel_request_${type}`
                    );
                }
                else if (type === 'port') {
                    const modal = buildPortfolioModal('portfolio_modal');
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

            // Sửa bài portfolio. Chỉ tác giả (hoặc admin) sửa được, và nội dung cũ được đọc
            // ngược từ chính embed đang hiển thị — bài portfolio không có row DB nào.
            const portfolioEditId = parsePortfolioEditId(interaction.customId);
            if (portfolioEditId) {
                const postAuthorId = interaction.message.mentions.users.first()?.id
                    ?? interaction.message.content.match(/^<@!?(\d{5,25})>/)?.[1]
                    ?? null;
                if (
                    postAuthorId
                    && interaction.user.id !== postAuthorId
                    && !interaction.memberPermissions?.has('Administrator')
                ) {
                    await interaction.reply({
                        content: `${config.ui.emojis.error} Chỉ tác giả bài này mới sửa được.`,
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }
                const current = readPortfolioEmbed(interaction.message.embeds[0]);
                await showModalSafely(
                    interaction,
                    buildPortfolioModal(`${PORTFOLIO_EDIT_PREFIX}${portfolioEditId}`, current),
                    client,
                    'portfolio_edit'
                );
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
                        const reposted = await (interaction.channel as TextChannel).send({
                            content: oldContent,
                            embeds: [oldEmbed],
                            components: oldComponents as any
                        });
                        // Nút Sửa mang messageId của tin CŨ; bump tạo tin mới nên phải gắn
                        // lại nút theo id mới, không thì bấm Sửa sẽ tìm một tin vừa bị xoá.
                        if (oldComponents.length) {
                            await reposted.edit({
                                components: [portfolioPostButtons(authorId, reposted.id)]
                            }).catch(() => {});
                        }
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
            // Music select: chọn bài trong queue / chọn kết quả search.
            if (interaction.customId.startsWith('music')) {
                await handleMusicComponent(interaction);
                return;
            }
            // Role menu kiểu select.
            if (interaction.customId.startsWith('rolemenu_')) {
                await handleRoleMenuComponent(interaction);
                return;
            }
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
            // Self-serve skill-role toggle (multi-select). Add/remove each chosen role.
            else if (interaction.customId === 'skillrole_toggle') {
                if (!interaction.guild) return;
                const results: string[] = [];
                let addedAny = false;
                for (const key of interaction.values) {
                    const state = await toggleSkillRole(interaction.guild, interaction.user.id, key);
                    const meta = getSkillMeta(key);
                    if (state === 'added') addedAny = true;
                    if (state) results.push(`${state === 'added' ? '✅' : '❌'} ${meta?.label || key}`);
                }

                // Đây là "nhiệm vụ" trong cổng chống bot của hệ thống mời: chọn lĩnh vực
                // xong mới bắt đầu tính mốc ở lại cho người đã mời mình.
                if (addedAny) {
                    const pending = await markRolePicked(interaction.user.id).catch(() => null);
                    if (pending?.status === 'PENDING' && pending.source === 'INVITE') {
                        const dueAt = Math.floor((pending.joinedAt.getTime() + config.invites.stayHours * 3_600_000) / 1000);
                        results.push(`\n${config.ui.emojis.contact} Đã ghi nhận. <@${pending.inviterId}> sẽ được tính lượt mời <t:${dueAt}:R> nếu bạn còn ở đây.`);
                    }
                }

                await safeInteractionReply(interaction, {
                    content: results.length ? results.join('\n') : `${config.ui.emojis.error} Không cập nhật được role kỹ năng.`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }
        else if (interaction.isModalSubmit()) {
            // startsWith chứ không phải so sánh bằng: modal mở trước lần deploy này có
            // customId đuôi "_<skill>", vẫn phải nhận để người đang mở form không mất bài.
            if (interaction.customId.startsWith('requestpaid_modal')) {
                await createRequestFromModal(interaction, interaction.client, 'PAID');

            } else if (interaction.customId.startsWith('requestfree_modal')) {
                await createRequestFromModal(interaction, interaction.client, 'FREE');

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
                    const targetChan = interaction.client.channels.cache.get(config.channels.portfolio) as TextChannel | undefined;
                    if (!targetChan?.isTextBased()) throw new Error('Không tìm thấy kênh portfolio đích.');
                    // Nút Sửa mang messageId của CHÍNH tin nhắn này, mà id chỉ có sau khi gửi
                    // — nên gửi trước rồi mới gắn nút vào.
                    const posted = await targetChan.send({ content: `<@${interaction.user.id}>`, embeds: [embed] });
                    await posted.edit({ components: [portfolioPostButtons(interaction.user.id, posted.id)] }).catch(() => {});
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
            } else if (parseRequestEditId(interaction.customId) !== null) {
                const acknowledged = await safeDeferEphemeral(interaction);
                if (!acknowledged) return;
                try {
                    const id = parseRequestEditId(interaction.customId)!;
                    const result = await applyRequestEdit({
                        id,
                        actorId: interaction.user.id,
                        isAdmin: interaction.memberPermissions?.has('Administrator') ?? false,
                        service: interaction.fields.getTextInputValue('service'),
                        description: interaction.fields.getTextInputValue('request_desc'),
                        // Đơn FREE không có ô này; getTextInputValue NÉM khi thiếu field.
                        budgetRaw: readOptionalModalField(() => interaction.fields.getTextInputValue('budget'))
                    });
                    await refreshRequestMessage(interaction.client, id).catch(() => {});
                    await interaction.editReply(`${config.ui.emojis.success} ${result.message}`).catch(() => {});
                } catch (error: any) {
                    await interaction.editReply(`${config.ui.emojis.error} ${error?.message || 'Không sửa được đơn.'}`).catch(() => {});
                }
            } else if (parsePortfolioEditId(interaction.customId)) {
                const acknowledged = await safeDeferEphemeral(interaction);
                if (!acknowledged) return;
                try {
                    const messageId = parsePortfolioEditId(interaction.customId)!;
                    const channel = await interaction.client.channels
                        .fetch(config.channels.portfolio)
                        .catch(() => null);
                    if (!channel?.isTextBased()) throw new Error('Không tìm thấy kênh portfolio.');
                    const message = await (channel as TextChannel).messages.fetch(messageId).catch(() => null);
                    if (!message) throw new Error('Bài này không còn nữa — có thể đã bị xoá hoặc bump lại (bump tạo tin mới).');

                    // Sửa embed của tin cũ chứ không đăng tin mới: bài giữ nguyên vị trí,
                    // và mọi link/ghim trỏ tới nó vẫn đúng.
                    const author = message.mentions.users.first() ?? interaction.user;
                    const embed = buildPortfolioEmbed(
                        author,
                        interaction.fields.getTextInputValue('name'),
                        interaction.fields.getTextInputValue('experience'),
                        interaction.fields.getTextInputValue('service'),
                        interaction.fields.getTextInputValue('portfolio_link'),
                        interaction.fields.getTextInputValue('contact')
                    );
                    await message.edit({
                        embeds: [embed],
                        components: [portfolioPostButtons(author.id, message.id)]
                    });
                    await interaction.editReply(
                        `${config.ui.emojis.success} Đã cập nhật bài quảng bá của bạn tại <#${config.channels.portfolio}>.`
                    ).catch(() => {});
                } catch (error: any) {
                    await interaction.editReply(
                        `${config.ui.emojis.error} ${error?.message || 'Không sửa được bài. Thử lại sau.'}`
                    ).catch(() => {});
                }
            } else if (interaction.customId === FREELANCER_EDIT_MODAL) {
                const acknowledged = await safeDeferEphemeral(interaction);
                if (!acknowledged) return;
                // Hai trường đều không bắt buộc: bỏ trống là muốn xoá trường đó, không phải
                // lỗi. getTextInputValue NÉM khi thiếu field nên phải bọc.
                await handleFreelancerEditModal(interaction, name =>
                    readOptionalModalField(() => interaction.fields.getTextInputValue(name))
                );
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
                        inviteBonusMode: draft?.inviteBonusMode || 'none',
                        inviteWeightPer: draft?.inviteWeightPer ?? undefined,
                        inviteWeightCap: draft?.inviteWeightCap ?? undefined,
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
