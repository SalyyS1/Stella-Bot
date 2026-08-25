import { EmbedBuilder, Events, GuildMember, TextChannel, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { config } from '../config';
import { sendAdminLog } from '../utils/adminLog';
import { recordJoin } from '../systems/invite/invite-attribution';
import { countVerifiedInvites, getLegacyUses } from '../systems/invite/invite-stats';
import { restoreStickyRoles } from '../systems/moderation/sticky-role-manager';
import { reportJoinRisk } from '../systems/moderation/join-risk-alert';
import { applyAutoRoles } from '../systems/roles/autorole-manager';
import { recordJoin as recordFreelancerJoin } from '../systems/freelancerManager';

export default {
    name: Events.GuildMemberAdd,
    once: false,
    async execute(member: GuildMember) {
        const emojis = config.ui.emojis;

        // Role kỷ luật phải được trả lại TRƯỚC mọi thứ khác: rời rồi vào lại là cách
        // né mute cổ điển nhất, và mỗi giây chờ là một giây họ nói được.
        const restored = await restoreStickyRoles(member).catch(() => null);

        // Bot được add thì không có "người mời" theo nghĩa lượt mời — ghi log riêng.
        if (member.user.bot) {
            await sendAdminLog(member.client, {
                title: 'Bot được thêm vào server',
                color: '#e67e22',
                fields: [{ name: 'Bot', value: `<@${member.id}> (${member.user.tag})` }]
            });
            return;
        }

        const attribution = await recordJoin(member).catch(error => {
            console.error('[invite] recordJoin lỗi:', error);
            return null;
        });

        // Cảnh báo acc đáng ngờ kèm nút Kick/Ban cho mod. Bot KHÔNG tự xử: dấu hiệu "acc
        // mới, không avatar" cũng đúng với người thật vừa lập Discord để vào server bạn bè.
        // Dùng lại tuổi acc mà recordJoin đã tính; không có thì tự tính từ createdTimestamp
        // để cảnh báo không mất khi invite tracking tắt.
        const ageDays = attribution?.accountAgeDays
            ?? Math.floor((Date.now() - member.user.createdTimestamp) / 86_400_000);
        await reportJoinRisk(member, ageDays).catch(error => console.error('[join-risk] lỗi:', error));

        // Autorole SAU restoreStickyRoles: role kỷ luật phải về trước, để một người vừa
        // né mute không có khoảng vài giây vừa có role member vừa chưa bị mute lại.
        const autoRoles = await applyAutoRoles(member).catch(error => {
            console.error('[autorole] lỗi:', error);
            return null;
        });

        const channel = await member.client.channels.fetch(config.channels.welcome).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            await sendAdminLog(member.client, {
                title: 'Welcome send failed',
                color: '#e74c3c',
                description: `Không tìm thấy kênh welcome <#${config.channels.welcome}> cho <@${member.id}>.`
            });
            return;
        }

        // Dòng "được ai mời". Với lượt không quy được về ai thì nói thẳng là vào bằng
        // link công khai — gán tên một người vào đó sẽ là thông tin sai giữa kênh
        // đông người nhất server.
        let inviteLine = '';
        if (attribution) {
            const [verified, legacy] = await Promise.all([
                countVerifiedInvites(attribution.inviterId),
                getLegacyUses(attribution.inviterId)
            ]);
            const total = verified + legacy;
            inviteLine = attribution.source === 'INVITE'
                ? `\n${emojis.contact} Được mời bởi <@${attribution.inviterId}> · đã mời **${total.toLocaleString('vi-VN')}** người`
                : `\n${emojis.contact} Vào bằng link công khai của server`;
        }

        const embed = new EmbedBuilder()
            .setColor('#ff66cc')
            .setTitle(`${emojis.starJump} Chào mừng đến với Stella`)
            .setDescription(
                `Chào mừng ${member} đã đến với **Stella**\n\n` +
                `${emojis.greenArrow} Bạn là thành viên thứ **${member.guild.memberCount.toLocaleString('vi-VN')}**` +
                inviteLine + '\n' +
                `${emojis.purpleArrow} Đọc luật tại <#${config.channels.rules}>\n` +
                `${emojis.purpleArrow} Chat tại <#${config.channels.chat}>\n` +
                `${emojis.purpleArrow} Showcase tại <#${config.channels.showcase}>\n` +
                `${emojis.redArrow} Tìm kiếm nhân lực tại <#${config.channels.requestPaid}>\n` +
                `${emojis.greenArrow} Show trình bản thân tại <#${config.channels.portfolio}>`
            )
            .setImage(config.welcome.banner)
            .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
            .setFooter({ text: 'Stella Studio' })
            .setTimestamp();

        // Biến cổng chống bot thành lời mời gọi: người mới thấy việc chọn lĩnh vực là
        // giúp người đã mời mình, không phải một thủ tục vô nghĩa.
        if (attribution?.source === 'INVITE' && attribution.status === 'PENDING') {
            embed.addFields({
                name: `${emojis.keep} Giúp người mời bạn một tay`,
                value: `Chọn lĩnh vực của bạn ở menu bên dưới, ở lại đủ **${config.invites.stayHours}h** ` +
                    `là <@${attribution.inviterId}> được ghi nhận lượt mời.`,
                inline: false
            });
        }

        // Persist join time so the 7-day retention metric is computable.
        await recordFreelancerJoin(member.id).catch(() => {});

        // Onboarding: let new members self-assign skill roles right away so
        // match-ping can reach them. A single ephemeral-style prompt in welcome.
        const skillMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('skillrole_toggle')
                .setPlaceholder('Chọn lĩnh vực của bạn để nhận yêu cầu phù hợp...')
                .setMinValues(0)
                .setMaxValues(config.skills.length)
                .addOptions(config.skills.map(s => ({ label: s.label, value: s.key })))
        );
        await (channel as TextChannel).send({ content: `${member}`, embeds: [embed], components: [skillMenu] });

        const accountAge = attribution ? `${attribution.accountAgeDays} ngày` : 'không rõ';
        await sendAdminLog(member.client, {
            title: 'Member joined',
            color: attribution?.status === 'REJECTED_YOUNG' ? '#e67e22' : '#2ecc71',
            fields: [
                { name: 'User', value: `<@${member.id}>`, inline: true },
                { name: 'Member Count', value: `${member.guild.memberCount}`, inline: true },
                { name: 'Tuổi tài khoản', value: accountAge, inline: true },
                {
                    name: 'Invite',
                    value: attribution
                        ? `Người mời: <@${attribution.inviterId}>\nMã: \`${attribution.code || 'không rõ'}\` · nguồn: \`${attribution.source}\`\n` +
                          `Trạng thái: \`${attribution.status}\`${attribution.isRejoin ? ' · **vào lại**' : ''}`
                        : 'Không theo dõi được (invite tracking tắt hoặc thiếu quyền).',
                    inline: false
                },
                ...(restored?.length
                    ? [{ name: 'Role kỷ luật đã trả lại', value: restored.map(id => `<@&${id}>`).join(', '), inline: false }]
                    : []),
                ...(autoRoles?.granted.length
                    ? [{ name: 'Autorole đã cấp', value: autoRoles.granted.map(id => `<@&${id}>`).join(', '), inline: false }]
                    : []),
                // Autorole bị chặn là chuyện admin PHẢI biết: nó nghĩa là danh sách
                // autorole có một role bot không được phép phát, và mọi người vào sau
                // cũng sẽ không nhận được nó.
                ...(autoRoles?.skipped.length
                    ? [{
                        name: 'Autorole bị chặn',
                        value: autoRoles.skipped.map(entry => `<@&${entry.roleId}>: ${entry.reason}`).join('\n').slice(0, 1000),
                        inline: false
                    }]
                    : [])
            ]
        });
    }
};
