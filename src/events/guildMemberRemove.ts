import { EmbedBuilder, Events, GuildMember, PartialGuildMember, TextChannel } from 'discord.js';
import { config } from '../config';
import { sendAdminLog } from '../utils/adminLog';
import { guardMemberRemove } from '../systems/antiRaidManager';

export default {
    name: Events.GuildMemberRemove,
    once: false,
    async execute(member: GuildMember | PartialGuildMember) {
        if (!member.partial) await guardMemberRemove(member);
        const channel = await member.client.channels.fetch(config.channels.welcome).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            await sendAdminLog(member.client, {
                title: 'Goodbye send failed',
                color: '#e74c3c',
                description: `Không tìm thấy kênh welcome <#${config.channels.welcome}> cho user ${member.id}.`
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor('#95a5a6')
            .setTitle('Tạm biệt một vì sao Stella')
            .setDescription(`**${member.user?.tag || member.id}** đã rời Stella. Hẹn gặp lại ở một dịp khác.`)
            .setThumbnail(member.user?.displayAvatarURL({ size: 256 }) || null)
            .setFooter({ text: 'Stella Studio' })
            .setTimestamp();

        await (channel as TextChannel).send({ embeds: [embed] });
        await sendAdminLog(member.client, {
            title: 'Member left',
            color: '#95a5a6',
            fields: [{ name: 'User', value: member.user ? `${member.user.tag} (${member.id})` : member.id }]
        });
    }
};
