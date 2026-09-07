import { EmbedBuilder, Events, GuildMember, PartialGuildMember, TextChannel } from 'discord.js';
import { config } from '../config';
import { sendAdminLog } from '../utils/adminLog';
import { guardMemberRemove } from '../systems/antiRaidManager';
import { markLeft } from '../systems/invite/invite-verification';
import { saveStickyRoles } from '../systems/moderation/sticky-role-manager';
import { handleMemberGone } from '../systems/request/request-lifecycle';

export default {
    name: Events.GuildMemberRemove,
    once: false,
    async execute(member: GuildMember | PartialGuildMember) {
        if (!member.partial) await guardMemberRemove(member);

        // Lưu role kỷ luật TRƯỚC mọi thứ khác: đây là lúc duy nhất còn đọc được role
        // của người vừa rời.
        const sticky = await saveStickyRoles(member).catch(() => [] as string[]);

        // Lượt mời chưa qua cổng ở-lại thì mất; đã tính rồi thì giữ, chỉ ghi mốc rời.
        await markLeft(member.id).catch(error => console.error('[invite] markLeft lỗi:', error));

        // Đơn hàng của người vừa rời. Không dọn thì đơn họ đang nhận KẸT VĨNH VIỄN ở
        // CLAIMED: nút huỷ nhận việc cần người bấm, mà người phải bấm đã đi rồi. Ban cũng
        // bắn event này nên một chỗ xử lý là đủ cho cả hai.
        await handleMemberGone(member.client, member.id, 'đã rời server')
            .catch(error => console.error('[request] dọn đơn khi member rời lỗi:', error));

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
            fields: [
                { name: 'User', value: member.user ? `${member.user.tag} (${member.id})` : member.id },
                ...(sticky.length
                    ? [{
                        name: 'Role kỷ luật đã ghi nhớ',
                        value: `${sticky.map(id => `<@&${id}>`).join(', ')}\n(sẽ tự trả lại nếu vào lại)`,
                        inline: false
                    }]
                    : [])
            ]
        });
    }
};
