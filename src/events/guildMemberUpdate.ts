import { EmbedBuilder, Events, GuildMember, PartialGuildMember } from 'discord.js';
import { config } from '../config';
import { sendMessageLog } from '../systems/logs/message-log-sender';

// Log thay đổi thành viên: nickname, role, timeout.
//
// Trong nhóm này, ROLE là thứ quan trọng nhất — nó trả lời "ai cấp quyền cho ai",
// câu hỏi mà một server bị chiếm quyền luôn phải trả lời sau đó. Nickname thì bắt
// được ca mạo danh mod.
export default {
    name: Events.GuildMemberUpdate,
    once: false,
    async execute(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) {
        if (!config.logs.enabled) return;
        if (oldMember.partial) return;

        const changes: { name: string; value: string }[] = [];

        if (oldMember.nickname !== newMember.nickname) {
            changes.push({
                name: 'Nickname',
                value: `\`${oldMember.nickname || newMember.user.username}\` → \`${newMember.nickname || newMember.user.username}\``
            });
        }

        const before = new Set(oldMember.roles.cache.keys());
        const after = new Set(newMember.roles.cache.keys());
        const added = [...after].filter(id => !before.has(id) && id !== newMember.guild.id);
        const removed = [...before].filter(id => !after.has(id) && id !== newMember.guild.id);
        if (added.length) changes.push({ name: 'Role được thêm', value: added.map(id => `<@&${id}>`).join(', ') });
        if (removed.length) changes.push({ name: 'Role bị gỡ', value: removed.map(id => `<@&${id}>`).join(', ') });

        const oldTimeout = oldMember.communicationDisabledUntilTimestamp ?? 0;
        const newTimeout = newMember.communicationDisabledUntilTimestamp ?? 0;
        if (oldTimeout !== newTimeout) {
            changes.push({
                name: 'Timeout',
                value: newTimeout > Date.now()
                    ? `bị câm tới <t:${Math.floor(newTimeout / 1000)}:f>`
                    : 'đã được gỡ timeout'
            });
        }

        if (!changes.length) return;

        await sendMessageLog(newMember.client, {
            embeds: [new EmbedBuilder()
                .setColor('#3498db')
                .setTitle('Thành viên thay đổi')
                .setThumbnail(newMember.user.displayAvatarURL({ size: 128 }))
                .setDescription(`<@${newMember.id}> (\`${newMember.user.tag}\`)`)
                .addFields(changes.map(change => ({ ...change, value: change.value.slice(0, 1000), inline: false })))
                .setFooter({ text: 'Ai thực hiện: xem hồ sơ kiểm duyệt hoặc audit log Discord' })
                .setTimestamp()]
        });
    }
};
