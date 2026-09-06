import { EmbedBuilder, Events, GuildMember, PartialGuildMember } from 'discord.js';
import { config } from '../config';
import { sendMessageLog } from '../systems/logs/message-log-sender';
import { resolveMemberActorsWithGrace, type MemberChangeKind } from '../systems/logs/audit-actor-resolver';

// Log thay đổi thành viên: nickname, role, timeout — kèm AI làm.
//
// Trong nhóm này, ROLE là thứ quan trọng nhất — nó trả lời "ai cấp quyền cho ai",
// câu hỏi mà một server bị chiếm quyền luôn phải trả lời sau đó. Nickname thì bắt
// được ca mạo danh mod. Người thực hiện lấy từ audit log qua audit-actor-resolver;
// không có thì ghi rõ "không rõ" chứ không đoán.
export default {
    name: Events.GuildMemberUpdate,
    once: false,
    async execute(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) {
        if (!config.logs.enabled) return;
        if (oldMember.partial) return;

        const changes: { name: string; value: string; kind: MemberChangeKind }[] = [];

        if (oldMember.nickname !== newMember.nickname) {
            changes.push({
                kind: 'nick',
                name: 'Nickname',
                value: `\`${oldMember.nickname || newMember.user.username}\` → \`${newMember.nickname || newMember.user.username}\``
            });
        }

        const before = new Set(oldMember.roles.cache.keys());
        const after = new Set(newMember.roles.cache.keys());
        const added = [...after].filter(id => !before.has(id) && id !== newMember.guild.id);
        const removed = [...before].filter(id => !after.has(id) && id !== newMember.guild.id);
        if (added.length) changes.push({ kind: 'roles', name: 'Role được thêm', value: added.map(id => `<@&${id}>`).join(', ') });
        if (removed.length) changes.push({ kind: 'roles', name: 'Role bị gỡ', value: removed.map(id => `<@&${id}>`).join(', ') });

        const oldTimeout = oldMember.communicationDisabledUntilTimestamp ?? 0;
        const newTimeout = newMember.communicationDisabledUntilTimestamp ?? 0;
        if (oldTimeout !== newTimeout) {
            changes.push({
                kind: 'timeout',
                name: 'Timeout',
                value: newTimeout > Date.now()
                    ? `bị câm tới <t:${Math.floor(newTimeout / 1000)}:f>`
                    : 'đã được gỡ timeout'
            });
        }

        if (!changes.length) return;

        const kinds = [...new Set(changes.map(change => change.kind))];
        const actors = await resolveMemberActorsWithGrace(newMember.id, kinds);
        const actorLines = kinds.map(kind => {
            const actorId = actors.get(kind) ?? null;
            const who = actorId === null
                ? 'không rõ'
                : actorId === newMember.id
                    ? 'tự đổi'
                    : actorId === newMember.client.user?.id
                        ? `<@${actorId}> (bot)`
                        : `<@${actorId}>`;
            return `${KIND_LABEL[kind]}: ${who}`;
        });

        await sendMessageLog(newMember.client, {
            embeds: [new EmbedBuilder()
                .setColor('#3498db')
                .setTitle('Thành viên thay đổi')
                .setThumbnail(newMember.user.displayAvatarURL({ size: 128 }))
                .setDescription(`<@${newMember.id}> (\`${newMember.user.tag}\`)`)
                .addFields(
                    ...changes.map(change => ({ name: change.name, value: change.value.slice(0, 1000), inline: false })),
                    { name: 'Ai thực hiện', value: actorLines.join('\n'), inline: false }
                )
                .setTimestamp()]
        });
    }
};

const KIND_LABEL: Record<MemberChangeKind, string> = {
    roles: 'Role',
    nick: 'Nickname',
    timeout: 'Timeout'
};
