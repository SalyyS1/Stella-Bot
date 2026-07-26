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
    TextChannel,
    Webhook
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
    | 'webhookCreate'
    | 'webhookUpdate'
    | 'webhookDelete';

const strikes = new Map<string, number[]>();
const recentRestores = new Set<string>();
const internalAllows = new Map<string, { expiresAt: number; count: number }>();
const consumedWebhookAuditEntries = new Map<string, number>();
const WEBHOOK_AUDIT_RETRY_DELAYS_MS = [0, 750, 1500];
const WEBHOOK_AUDIT_ENTRY_TTL_MS = 60_000;

function isEnabled(): boolean {
    return Boolean(config.antiRaid.enabled);
}

function isSelf(client: Client, userId?: string | null): boolean {
    return Boolean(userId && client.user?.id === userId);
}

function allowKey(action: GuardAction, targetId: string): string {
    return `${action}:${targetId}`;
}

function hasInternalAllow(action: GuardAction, targetId?: string | null): boolean {
    const now = Date.now();
    const keys = [allowKey(action, '*')];
    if (targetId) keys.push(allowKey(action, targetId));

    for (const key of keys) {
        const allow = internalAllows.get(key);
        if (!allow) continue;
        if (allow.expiresAt >= now) {
            if (allow.count > 1) internalAllows.set(key, { ...allow, count: allow.count - 1 });
            else internalAllows.delete(key);
            return true;
        }
        internalAllows.delete(key);
    }
    return false;
}

export function markInternalAntiRaidAction(action: GuardAction, targetId: string, ttlMs = 20_000): void {
    const key = allowKey(action, targetId);
    const current = internalAllows.get(key);
    internalAllows.set(key, {
        expiresAt: Date.now() + ttlMs,
        count: current && current.expiresAt >= Date.now() ? current.count + 1 : 1
    });
}

export function antiRaidStatus() {
    const now = Date.now();
    for (const [key, times] of strikes) {
        const active = pruneWindow(times);
        if (active.length) strikes.set(key, active);
        else strikes.delete(key);
    }
    for (const [key, allow] of internalAllows) {
        if (allow.expiresAt < now) internalAllows.delete(key);
    }
    for (const [key, expiresAt] of consumedWebhookAuditEntries) {
        if (expiresAt < now) consumedWebhookAuditEntries.delete(key);
    }
    return {
        enabled: isEnabled(),
        activeStrikeGroups: strikes.size,
        pendingInternalActions: internalAllows.size,
        recentRestores: recentRestores.size,
        windowMs: config.antiRaid.windowMs
    };
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

async function fetchRecentAudits(guild: Guild, type: AuditLogEvent, limit = 6): Promise<GuildAuditLogsEntry[]> {
    const logs = await guild.fetchAuditLogs({ type, limit }).catch(() => null);
    if (!logs) return [];
    const recent = Date.now() - 15_000;
    return [...logs.entries.values()].filter(entry =>
        entry.executorId && entry.createdTimestamp >= recent
    );
}

async function fetchRecentAudit(guild: Guild, type: AuditLogEvent, targetId?: string): Promise<GuildAuditLogsEntry | null> {
    const entries = await fetchRecentAudits(guild, type);
    return entries.find(entry => !targetId || entry.targetId === targetId) || null;
}

function webhookAuditKey(guildId: string, entry: GuildAuditLogsEntry): string {
    return `${guildId}:${entry.id}`;
}

function pruneConsumedWebhookAuditEntries(): void {
    const now = Date.now();
    for (const [key, expiresAt] of consumedWebhookAuditEntries) {
        if (expiresAt < now) consumedWebhookAuditEntries.delete(key);
    }
}

function isConsumedWebhookAuditEntry(guildId: string, entry: GuildAuditLogsEntry): boolean {
    return consumedWebhookAuditEntries.has(webhookAuditKey(guildId, entry));
}

function consumeWebhookAuditEntry(guildId: string, entry: GuildAuditLogsEntry): void {
    pruneConsumedWebhookAuditEntries();
    consumedWebhookAuditEntries.set(webhookAuditKey(guildId, entry), Date.now() + WEBHOOK_AUDIT_ENTRY_TTL_MS);
}

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function punishActor(guild: Guild, actorId: string, reason: string): Promise<string> {
    if (isSelf(guild.client, actorId)) return 'self-token-suspected-rotate-token';

    const member = await guild.members.fetch(actorId).catch(() => null);
    if (!member) return 'member-not-found';

    let attempted = false;
    if (member.bannable) {
        attempted = true;
        if (await member.ban({ reason }).then(() => true).catch(() => false)) return 'banned';
    }
    if (member.kickable) {
        attempted = true;
        if (await member.kick(reason).then(() => true).catch(() => false)) return 'kicked';
    }
    if (member.moderatable) {
        attempted = true;
        if (await member.timeout(24 * 60 * 60 * 1000, reason).then(() => true).catch(() => false)) return 'timed-out';
    }
    return attempted ? 'punishment-failed' : 'no-permission';
}

// Members holding the trusted role are exempt from automated punishment — the
// event is still logged so admins see it. This protects legitimate staff doing
// bulk setup (e.g. creating several channels for an event) from being banned by
// threshold triggers. The suspected-compromised-self-token case is never exempt.
async function isTrustedActor(guild: Guild, actorId: string): Promise<boolean> {
    const trustedRoleId = config.roles.trusted;
    if (!trustedRoleId) return false;
    const member = await guild.members.fetch(actorId).catch(() => null);
    return Boolean(member?.roles.cache.has(trustedRoleId));
}

async function recordAndMaybePunish(
    client: Client,
    guild: Guild,
    action: GuardAction,
    actorId: string | null | undefined,
    detail: string
): Promise<void> {
    if (!actorId) return;
    const count = addStrike(actorId, action);
    const selfActor = isSelf(client, actorId);
    const shouldPunish = selfActor || count >= threshold(action);
    const trusted = shouldPunish && !selfActor && await isTrustedActor(guild, actorId);
    const result = trusted
        ? 'trusted-role-exempt'
        : shouldPunish
            ? await punishActor(guild, actorId, `${config.antiRaid.punishmentReason}: ${action}`)
            : 'watching';

    await sendAdminLog(client, {
        title: selfActor ? 'CRITICAL: Stella self-action blocked' : shouldPunish ? 'Anti-raid action blocked' : 'Anti-raid event detected',
        color: selfActor ? '#ff0000' : shouldPunish ? '#e74c3c' : '#f1c40f',
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
            markInternalAntiRaidAction('channelUpdate', created.id);
            await created.setPosition(old.rawPosition).catch(() => {});
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

export async function guardEveryoneMention(message: Message): Promise<boolean> {
    if (!isEnabled() || !message.guild) return false;
    if (!message.mentions.everyone) return false;

    await message.delete().catch(() => {});

    let detail = `Deleted everyone/here mention in <#${message.channelId}>`;
    if (message.webhookId) {
        const webhookResult = await deleteSuspiciousWebhook(message, message.webhookId);
        detail += `; webhook ${message.webhookId}: ${webhookResult}`;
    }

    await recordAndMaybePunish(
        message.client,
        message.guild,
        'everyoneMention',
        message.author.id,
        detail
    );
    return true;
}

async function deleteSuspiciousWebhook(message: Message, webhookId: string): Promise<string> {
    if (!message.guild?.members.me?.permissions.has(PermissionFlagsBits.ManageWebhooks)) return 'no-manage-webhooks-permission';
    const webhook = await message.client.fetchWebhook(webhookId).catch(() => null) as Webhook | null;
    if (!webhook) return 'not-found';
    markInternalAntiRaidAction('webhookDelete', message.channelId);
    return await webhook.delete(`${config.antiRaid.punishmentReason}: webhook everyone/here mention`)
        .then(() => 'deleted')
        .catch(() => 'delete-failed');
}

export async function guardChannelCreate(channel: GuildBasedChannel): Promise<void> {
    if (!isEnabled() || recentRestores.has(channel.id)) return;
    const entry = await fetchRecentAudit(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    const actorId = entry?.executorId;
    if (isSelf(channel.client, actorId) && hasInternalAllow('channelCreate', channel.id)) return;

    const count = actorId ? addStrike(actorId, 'channelCreate') : 0;
    const shouldDelete = Boolean(actorId && (isSelf(channel.client, actorId) || count >= threshold('channelCreate')));
    const trusted = shouldDelete && !isSelf(channel.client, actorId) && await isTrustedActor(channel.guild, actorId!);
    let result = trusted
        ? 'trusted-role-exempt'
        : shouldDelete ? await punishActor(channel.guild, actorId!, `${config.antiRaid.punishmentReason}: channelCreate`) : 'watching';
    if (shouldDelete && !trusted && canManageChannels(channel.guild)) {
        const deleted = await channel.delete(`${config.antiRaid.punishmentReason}: mass channel create`)
            .then(() => true)
            .catch(() => false);
        result += deleted ? ', deleted-created-channel' : ', channel-delete-failed';
    }

    if (actorId) {
        await sendAdminLog(channel.client, {
            title: isSelf(channel.client, actorId) ? 'CRITICAL: Stella created channel outside internal flow' : shouldDelete ? 'Mass channel create blocked' : 'Channel create detected',
            color: isSelf(channel.client, actorId) ? '#ff0000' : shouldDelete ? '#e74c3c' : '#f1c40f',
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
    if (isSelf(channel.client, actorId) && hasInternalAllow('channelDelete', channel.id)) return;

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
    if (isSelf(newChannel.client, actorId) && hasInternalAllow('channelUpdate', newChannel.id)) return;

    if (canManageChannels(newChannel.guild)) {
        if (oldChannel.name !== newChannel.name) {
            markInternalAntiRaidAction('channelUpdate', newChannel.id);
            await (newChannel as any).setName(oldChannel.name || 'restored-channel', config.antiRaid.punishmentReason).catch(() => {});
        }
        if ('topic' in oldChannel && 'setTopic' in newChannel && oldChannel.topic !== (newChannel as TextChannel).topic) {
            markInternalAntiRaidAction('channelUpdate', newChannel.id);
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
    if (isSelf(guild.client, entry?.executorId) && hasInternalAllow('memberBan', userId)) return;
    await recordAndMaybePunish(guild.client, guild, 'memberBan', entry?.executorId, `Banned user <@${userId}>`);
}

export async function guardMemberRemove(member: GuildMember): Promise<void> {
    if (!isEnabled()) return;
    const entry = await fetchRecentAudit(member.guild, AuditLogEvent.MemberKick, member.id);
    if (!entry) return;
    if (isSelf(member.client, entry.executorId) && hasInternalAllow('memberKick', member.id)) return;
    await recordAndMaybePunish(member.client, member.guild, 'memberKick', entry.executorId, `Kicked user <@${member.id}>`);
}

export async function guardRoleCreate(role: Role): Promise<void> {
    if (!isEnabled()) return;
    const entry = await fetchRecentAudit(role.guild, AuditLogEvent.RoleCreate, role.id);
    if (isSelf(role.client, entry?.executorId) && hasInternalAllow('roleCreate', role.id)) return;
    await recordAndMaybePunish(role.client, role.guild, 'roleCreate', entry?.executorId, `Created role ${role.name}`);
}

export async function guardRoleDelete(role: Role): Promise<void> {
    if (!isEnabled()) return;
    const entry = await fetchRecentAudit(role.guild, AuditLogEvent.RoleDelete, role.id);
    if (isSelf(role.client, entry?.executorId) && hasInternalAllow('roleDelete', role.id)) return;
    await recordAndMaybePunish(role.client, role.guild, 'roleDelete', entry?.executorId, `Deleted role ${role.name}`);
}

export async function guardRoleUpdate(oldRole: Role, newRole: Role): Promise<void> {
    if (!isEnabled()) return;
    if (oldRole.name === newRole.name && oldRole.permissions.bitfield === newRole.permissions.bitfield) return;
    const entry = await fetchRecentAudit(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    const actorId = entry?.executorId;
    if (isSelf(newRole.client, actorId) && hasInternalAllow('roleUpdate', newRole.id)) return;

    markInternalAntiRaidAction('roleUpdate', newRole.id);
    await newRole.edit({
        name: oldRole.name,
        permissions: oldRole.permissions,
        reason: config.antiRaid.punishmentReason
    }).catch(() => {});

    await recordAndMaybePunish(newRole.client, newRole.guild, 'roleUpdate', actorId, `Changed role ${newRole.name}; attempted rollback`);
}

const webhookAuditActions = [
    { type: AuditLogEvent.WebhookCreate, action: 'webhookCreate' as const, label: 'created' },
    { type: AuditLogEvent.WebhookUpdate, action: 'webhookUpdate' as const, label: 'updated' },
    { type: AuditLogEvent.WebhookDelete, action: 'webhookDelete' as const, label: 'deleted' }
];

export async function guardWebhookUpdate(channel: Channel): Promise<void> {
    if (!isEnabled() || !('guild' in channel) || !channel.guild) return;

    for (const delay of WEBHOOK_AUDIT_RETRY_DELAYS_MS) {
        if (delay) await wait(delay);
        pruneConsumedWebhookAuditEntries();

        const entries = (await Promise.all(webhookAuditActions.map(async action =>
            (await fetchRecentAudits(channel.guild!, action.type, 100)).map(entry => ({
                ...action,
                entry
            }))
        ))).flat();
        const match = entries
            .filter(item =>
                !isConsumedWebhookAuditEntry(channel.guild!.id, item.entry) &&
                (item.entry.target as Webhook | null)?.channelId === channel.id
            )
            .sort((a, b) => b.entry.createdTimestamp - a.entry.createdTimestamp)[0];
        if (!match) continue;

        consumeWebhookAuditEntry(channel.guild.id, match.entry);
        if (isSelf(channel.client, match.entry.executorId) && hasInternalAllow(match.action, channel.id)) return;

        await recordAndMaybePunish(
            channel.client,
            channel.guild,
            match.action,
            match.entry.executorId,
            `Webhook ${match.label} in <#${channel.id}>`
        );
        return;
    }
}
