import { EmbedBuilder, Events, GuildMember, TextChannel, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { config } from '../config';
import { sendAdminLog } from '../utils/adminLog';
import { recordJoin } from '../systems/freelancerManager';

export default {
    name: Events.GuildMemberAdd,
    once: false,
    async execute(member: GuildMember) {
        const emojis = config.ui.emojis;
        const channel = await member.client.channels.fetch(config.channels.welcome).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            await sendAdminLog(member.client, {
                title: 'Welcome send failed',
                color: '#e74c3c',
                description: `Không tìm thấy kênh welcome <#${config.channels.welcome}> cho <@${member.id}>.`
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor('#ff66cc')
            .setTitle(`${emojis.starJump} Chào mừng đến với Stella`)
            .setDescription(
                `Chào mừng ${member} đã đến với **Stella**\n\n` +
                `${emojis.greenArrow} Bạn là thành viên thứ **${member.guild.memberCount.toLocaleString('vi-VN')}**\n` +
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

        // Persist join time so the 7-day retention metric is computable.
        await recordJoin(member.id).catch(() => {});

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
        await sendAdminLog(member.client, {
            title: 'Member joined',
            color: '#2ecc71',
            fields: [
                { name: 'User', value: `<@${member.id}>`, inline: true },
                { name: 'Member Count', value: `${member.guild.memberCount}`, inline: true }
            ]
        });
    }
};
