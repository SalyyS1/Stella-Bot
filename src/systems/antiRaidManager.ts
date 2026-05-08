import {
    AuditLogEvent,
    CategoryChannel,
    Channel,
    ChannelType,
    Client,
    Guild,
    GuildAuditLogsEntry,
    GuildBasedChannel,
    GuildMember,
    Message,
    NonThreadGuildBasedChannel,
    PermissionFlagsBits,
    Role,
    TextChannel
} from 'discord.js';
import { config } from '../config';
import { sendAdminLog } from '../utils/adminLog';

type GuardAction =
    | 'everyoneMention'
    | 'channelCreate'
    | 'channelDelete'
    | 'channelUpdate'
    | 'memberKick'
    | 'memberBan'
    | 'roleCreate'
    | 'roleDelete'
    | 'roleUpdate'
    | 'webhookCreate';

const strikes = new Map<string, number[]>();
const recentRestores = new Set<string>();

function isEnabled(): boolean {
    return Boolean(config.antiRaid.enabled);
}

function isSelf(client: Client, userId?: string | null): boolean {
    return Boolean(userId && client.user?.id === userId);
}

function pruneWindow(times: number[]): number[] {
    const since = Date.now() - config.antiRaid.windowMs;
    return times.filter(time => time >= since);
}

function addStrike(actorId: string, action: GuardAction): number {
    const key = `${actorId}:${action}`;
    const next = [...pruneWindow(strikes.get(key) || []), Date.now()];
    strikes.set(key, next);
    return next.length;
}

function threshold(action: GuardAction): number {
    return config.antiRaid.thresholds[action] || 1;
}

async function fetchRecentAudit(guild: Guild, type: AuditLogEvent, targetId?: string): Promise<GuildAuditLogsEntry | null> {
    const logs = await guild.fetchAuditLogs({ type, limit: 6 }).catch(() => null);
    if (!logs) return null;
    const recent = Date.now() - 15_000;
    return logs.entries.find(entry =>
        (!targetId || entry.targetId === targetId) &&
        entry.executorId &&
        entry.createdTimestamp >= recent
    ) || null;
}

async function punishActor(guild: Guild, actorId: string, reason: string): Promise<string> {
    if (isSelf(guild.client, actorId)) return 'ignored-self';

    const member = await guild.members.fetch(actorId).catch(() => null);
    if (member?.bannable) {
        await member.ban({ reason }).catch(() => null);
        return 'banned';
    }
    if (member?.kickable) {
        await member.kick(reason).catch(() => null);
        return 'kicked';
    }
    if (member?.moderatable) {
        await member.timeout(24 * 60 * 60 * 1000, reason).catch(() => null);
        return 'timed-out';
    }
    return 'no-permission';
}

async function recordAndMaybePunish(
    client: Client,
    guild: Guild,
    action: GuardAction,
    actorId: string | null | undefined,
    detail: string
): Promise<void> {
    if (!actorId || isSelf(client, actorId)) return;
    const count = addStrike(actorId, action);
    const shouldPunish = count >= threshold(action);
    const result = shouldPunish
        ? await punishActor(guild, actorId, `${config.antiRaid.punishmentReason}: ${action}`)
        : 'watching';

    await sendAdminLog(client, {
        title: shouldPunish ? 'Anti-raid action blocked' : 'Anti-raid event detected',
        color: shouldPunish ? '#e74c3c' : '#f1c40f',
        fields: [
            { name: 'Actor', value: `<@${actorId}>`, inline: true },
            { name: 'Action', value: action, inline: true },
            { name: 'Strike', value: `${count}/${threshold(action)}`, inline: true },
            { name: 'Result', value: result, inline: true },
            { name: 'Detail', value: detail.slice(0, 1000) || 'No detail' }
        ]
    });
}

function canManageChannels(guild: Guild): boolean {
    return Boolean(guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels));
}

async function restoreDeletedChannel(channel: Channel, actorId: string | null | undefined): Promise<string> {
    if (!('guild' in channel) || !channel.guild || !canManageChannels(channel.guild)) return 'no-manage-channel-permission';
    if (channel.isThread()) return 'ignored-thread';

    const old = channel as NonThreadGuildBasedChannel;
    const parent = 'parentId' in old ? old.parentId || undefined : undefined;
    const permissionOverwrites = 'permissionOverwrites' in old
        ? old.permissionOverwrites.cache.map(overwrite => ({
            id: overwrite.id,
            allow: overwrite.allow,
            deny: overwrite.deny,
            type: overwrite.type
        }))
        : undefined;

    if (old.type === ChannelType.GuildText || old.type === ChannelType.GuildAnnouncement) {
        const text = old as TextChannel;
        const created = await old.guild.channels.create({
            name: old.name,
            type: old.type,
            parent,
            topic: text.topic || undefined,
            nsfw: text.nsfw,
            rateLimitPerUser: text.rateLimitPerUser,
            permissionOverwrites,
            reason: `${config.antiRaid.punishmentReason}: restore deleted channel by ${actorId || 'unknown'}`
        }).catch(() => null);
        if (created) {
            recentRestores.add(created.id);
            setTimeout(() => recentRestores.delete(created.id), 30_000);
            return `restored <#${created.id}>`;
        }
    }

    if (old.type === ChannelType.GuildCategory) {
        const category = old as CategoryChannel;
        const created = await old.guild.channels.create({
            name: old.name,
            type: ChannelType.GuildCategory,
            permissionOverwrites,
            reason: `${config.antiRaid.punishmentReason}: restore deleted category by ${actorId || 'unknown'}`
        }).catch(() => null);
        if (created) {
            recentRestores.add(created.id);
            setTimeout(() => recentRestores.delete(created.id), 30_000);
            await created.setPosition(category.rawPosition).catch(() => {});
            return `restored category ${created.name}`;
        }
    }

    return 'restore-unsupported-channel-type';
}

export async function guardEveryoneMention(message: Message): Promise<void> {
    if (!isEnabled() || !message.guild || message.author.id === message.client.user?.id) return;
    if (!message.mentions.everyone) return;

    await message.delete().catch(() => {});
    await recordAndMaybePunish(
        message.client,
        message.guild,
        'everyoneMention',
        message.author.id,
        `Deleted everyone/here mention in <#${message.channelId}>`
    );
}

export async function guardChannelCreate(channel: GuildBasedChannel): Promise<void> {
    if (!isEnabled() || recentRestores.has(channel.id)) return;
    const entry = await fetchRecentAudit(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    const actorId = entry?.executorId;
    if (isSelf(channel.client, actorId)) return;

    const count = actorId ? addStrike(actorId, 'channelCreate') : 0;
    const shouldDelete = Boolean(actorId && count >= threshold('channelCreate'));
    let result = shouldDelete ? await punishActor(channel.guild, actorId!, `${config.antiRaid.punishmentReason}: channelCreate`) : 'watching';
    if (shouldDelete && canManageChannels(channel.guild)) {
        await channel.delete(`${config.antiRaid.punishmentReason}: mass channel create`).catch(() => null);
        result += ', deleted-created-channel';
    }

    if (actorId) {
        await sendAdminLog(channel.client, {
            title: shouldDelete ? 'Mass channel create blocked' : 'Channel create detected',
            color: shouldDelete ? '#e74c3c' : '#f1c40f',
            fields: [
                { name: 'Actor', value: `<@${actorId}>`, inline: true },
                { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                { name: 'Strike', value: `${count}/${threshold('channelCreate')}`, inline: true },
                { name: 'Result', value: result }
            ]
        });
    }
}

export async function guardChannelDelete(channel: Channel): Promise<void> {
    if (!isEnabled() || !('guild' in channel) || !channel.guild) return;
    const entry = await fetchRecentAudit(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    const actorId = entry?.executorId;
    if (isSelf(channel.client, actorId)) return;

    const restoreResult = await restoreDeletedChannel(channel, actorId);
    await recordAndMaybePunish(
        channel.client,
        channel.guild,
        'channelDelete',
        actorId,
        `Deleted channel ${'name' in channel ? channel.name : (channel as { id: string }).id}; ${restoreResult}`
    );
}

export async function guardChannelUpdate(oldChannel: Channel, newChannel: Channel): Promise<void> {
    if (!isEnabled() || !('guild' in newChannel) || !newChannel.guild || !('name' in oldChannel) || !('name' in newChannel)) return;
    if (oldChannel.name === newChannel.name && (!('topic' in oldChannel) || oldChannel.topic === (newChannel as TextChannel).topic)) return;

    const entry = await fetchRecentAudit(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
    const actorId = entry?.executorId;
    if (isSelf(newChannel.client, actorId)) return;

    if (canManageChannels(newChannel.guild)) {
        if (oldChannel.name !== newChannel.name) await (newChannel as any).setName(oldChannel.name || 'restored-channel', config.antiRaid.punishmentReason).catch(() => {});
        if ('topic' in oldChannel && 'setTopic' in newChannel && oldChannel.topic !== (newChannel as TextChannel).topic) {
            await (newChannel as TextChannel).setTopic(oldChannel.topic || null, config.antiRaid.punishmentReason).catch(() => {});
        }
    }

    await recordAndMaybePunish(
        newChannel.client,
        newChannel.guild,
        'channelUpdate',
        actorId,
        `Changed channel <#${newChannel.id}>; attempted rollback name/topic`
    );
}

export async function guardGuildBanAdd(guild: Guild, userId: string): Promise<void> {
    if (!isEnabled()) return;
    const entry = await fetchRecentAudit(guild, AuditLogEvent.MemberBanAdd, userId);
    await recordAndMaybePunish(guild.client, guild, 'memberBan', entry?.executorId, `Banned user <@${userId}>`);
}

export async function guardMemberRemove(member: GuildMember): Promise<void> {
    if (!isEnabled()) return;
    const entry = await fetchRecentAudit(member.guild, AuditLogEvent.MemberKick, member.id);
    if (!entry) return;
    await recordAndMaybePunish(member.client, member.guild, 'memberKick', entry.executorId, `Kicked user <@${member.id}>`);
}

export async function guardRoleCreate(role: Role): Promise<void> {
    if (!isEnabled()) return;
    const entry = await fetchRecentAudit(role.guild, AuditLogEvent.RoleCreate, role.id);
    await recordAndMaybePunish(role.client, role.guild, 'roleCreate', entry?.executorId, `Created role ${role.name}`);
}

export async function guardRoleDelete(role: Role): Promise<void> {
    if (!isEnabled()) return;
    const entry = await fetchRecentAudit(role.guild, AuditLogEvent.RoleDelete, role.id);
    await recordAndMaybePunish(role.client, role.guild, 'roleDelete', entry?.executorId, `Deleted role ${role.name}`);
}

export async function guardRoleUpdate(oldRole: Role, newRole: Role): Promise<void> {
    if (!isEnabled()) return;
    if (oldRole.name === newRole.name && oldRole.permissions.bitfield === newRole.permissions.bitfield) return;
    const entry = await fetchRecentAudit(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    const actorId = entry?.executorId;
    if (isSelf(newRole.client, actorId)) return;

    await newRole.edit({
        name: oldRole.name,
        permissions: oldRole.permissions,
        reason: config.antiRaid.punishmentReason
    }).catch(() => {});

    await recordAndMaybePunish(newRole.client, newRole.guild, 'roleUpdate', actorId, `Changed role ${newRole.name}; attempted rollback`);
}

export async function guardWebhookCreate(channel: Channel): Promise<void> {
    if (!isEnabled() || !('guild' in channel) || !channel.guild) return;
    const entry = await fetchRecentAudit(channel.guild, AuditLogEvent.WebhookCreate);
    await recordAndMaybePunish(channel.client, channel.guild, 'webhookCreate', entry?.executorId, `Webhook created in ${'id' in channel ? `<#${channel.id}>` : 'unknown channel'}`);
}
