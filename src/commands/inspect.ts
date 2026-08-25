import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { getAuthorActivity } from '../systems/logs/message-mirror';
import { countActiveWarns } from '../systems/moderation/mod-case-manager';
import { getInviteStats, getInviterOf } from '../systems/invite/invite-stats';

export default {
    data: new SlashCommandBuilder()
        .setName('inspect')
        .setDescription('[Mod] Xem toàn bộ bối cảnh của một thành viên trong một thẻ')
        .addUserOption(option => option.setName('user').setDescription('Thành viên cần soi').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Moderate Members.`, flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const target = interaction.options.getUser('user', true);

        try {
            const [member, user, activity, warns, inviteStats, inviter] = await Promise.all([
                interaction.guild?.members.fetch(target.id).catch(() => null) ?? Promise.resolve(null),
                prisma.user.findUnique({ where: { id: target.id } }).catch(() => null),
                getAuthorActivity(target.id),
                countActiveWarns(target.id),
                getInviteStats(target.id),
                getInviterOf(target.id)
            ]);

            const accountAgeDays = Math.floor((Date.now() - target.createdTimestamp) / 86_400_000);
            const joinedDays = member?.joinedTimestamp
                ? Math.floor((Date.now() - member.joinedTimestamp) / 86_400_000)
                : null;

            // Cờ nghi vấn: không phải kết luận, chỉ là thứ đáng nhìn kỹ trước khi xử.
            const flags: string[] = [];
            if (accountAgeDays < config.invites.minAccountAgeDays) flags.push(`acc mới **${accountAgeDays}** ngày`);
            if (!target.avatar) flags.push('không có avatar');
            if (joinedDays !== null && joinedDays < 1) flags.push('vừa vào hôm nay');
            if (activity.deleted7d >= 10) flags.push(`**${activity.deleted7d}** tin bị xoá trong 7 ngày`);
            if (warns.warns >= 2) flags.push(`**${warns.warns}** warn còn hiệu lực`);
            if (!member) flags.push('**không còn trong server**');

            const roleList = member
                ? member.roles.cache
                    .filter(role => role.id !== interaction.guild!.id)
                    .sort((a, b) => b.position - a.position)
                    .map(role => role.toString())
                    .slice(0, 10)
                    .join(' ') || '*không có*'
                : '*không còn trong server*';

            const inviterLine = inviter
                ? inviter.source === 'INVITE'
                    ? `<@${inviter.inviterId}> · trạng thái \`${inviter.status}\`${inviter.rejoinCount ? ` · vào lại ${inviter.rejoinCount}×` : ''}`
                    : 'vào bằng link công khai'
                : '*không có dữ liệu (vào trước khi bật hệ thống mời)*';

            const embed = new EmbedBuilder()
                .setColor(flags.length ? '#e67e22' : '#3498db')
                .setAuthor({ name: `Soi thành viên · ${target.tag}`, iconURL: target.displayAvatarURL({ size: 128 }) })
                .setThumbnail(target.displayAvatarURL({ size: 256 }))
                .addFields(
                    {
                        name: 'Tài khoản',
                        value: `> ID: \`${target.id}\`\n> Tạo: <t:${Math.floor(target.createdTimestamp / 1000)}:d> (**${accountAgeDays}** ngày)\n` +
                            `> Vào server: ${member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:d> (**${joinedDays}** ngày)` : '*không rõ*'}`,
                        inline: false
                    },
                    {
                        name: 'Hoạt động (từ bản sao tin nhắn)',
                        value: `> 24h: **${activity.last24h}** tin · 7 ngày: **${activity.last7d}** tin\n` +
                            `> 7 ngày bị xoá: **${activity.deleted7d}** · đã sửa: **${activity.edited7d}**`,
                        inline: false
                    },
                    {
                        name: 'Cộng đồng',
                        value: `> Level **${user?.level ?? 1}** · XP **${(user?.xp ?? 0).toLocaleString('vi-VN')}** · Scoin **${(user?.scoinBalance ?? 0).toLocaleString('vi-VN')}**\n` +
                            `> Đã mời: **${inviteStats.total}** (đã tính **${inviteStats.verified}**, chờ **${inviteStats.pending}**)\n` +
                            `> Được mời bởi: ${inviterLine}`,
                        inline: false
                    },
                    {
                        name: 'Kiểm duyệt',
                        value: `> Warn còn hiệu lực: **${warns.warns}** · tổng hồ sơ: **${warns.total}**`,
                        inline: false
                    },
                    { name: 'Role', value: `> ${roleList}`, inline: false }
                )
                .setFooter({ text: 'Hoạt động chỉ tính trong thời gian còn giữ bản sao tin nhắn' })
                .setTimestamp();

            if (flags.length) {
                embed.addFields({ name: `${emojis.appeal} Đáng nhìn kỹ`, value: flags.map(flag => `> ${flag}`).join('\n'), inline: false });
            }

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`inspect_recent_${target.id}`).setLabel('10 tin gần nhất').setStyle(ButtonStyle.Primary)
            );

            return interaction.editReply({ embeds: [embed], components: [row] });
        } catch (error: any) {
            console.error('[inspect] lỗi:', error);
            return interaction.editReply(`${emojis.error} ${error?.message || 'Không soi được thành viên này.'}`);
        }
    }
};
