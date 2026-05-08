import { CategoryChannel, ChannelType, Client, EmbedBuilder, GuildTextBasedChannel, TextChannel } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { sendAdminLog } from '../utils/adminLog';
import { buildServerAdsGuideEmbed } from './serverAdsManager';
import { getManagedChannelId, ManagedChannelKey, setManagedChannelId } from '../utils/managedChannels';
import { markInternalAntiRaidAction } from './antiRaidManager';

export type MaintenanceTarget = ManagedChannelKey;

function currentSaigonDateParts(): { day: string; period: string } {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: config.maintenance.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const year = parts.find(p => p.type === 'year')?.value || '0000';
    const month = parts.find(p => p.type === 'month')?.value || '00';
    const day = parts.find(p => p.type === 'day')?.value || '00';
    return { day, period: `${year}-${month}` };
}

function configuredParentId(target: MaintenanceTarget): string | null {
    if (target === 'serverAds') return config.maintenance.categories.serverAds;
    return config.maintenance.categories.requests;
}

function targetNameCandidates(target: MaintenanceTarget): string[] {
    if (target === 'serverAds') return ['server-ads', 'server ads', 'ads'];
    if (target === 'requestPaid') return ['request-paid', 'paid-request', 'paid request', 'request paid'];
    return ['request-free', 'free-request', 'free request', 'request free'];
}

async function findTextChannelInCategory(client: Client, target: MaintenanceTarget, parentId: string | null): Promise<TextChannel | null> {
    if (!parentId) return null;
    const parent = await client.channels.fetch(parentId).catch(() => null);
    if (!parent || parent.type !== ChannelType.GuildCategory) return null;

    const candidates = targetNameCandidates(target);
    const channel = (parent as CategoryChannel).children.cache.find(child =>
        child.type === ChannelType.GuildText &&
        candidates.some(name => child.name.toLowerCase().includes(name))
    );
    return channel && channel.type === ChannelType.GuildText ? channel as TextChannel : null;
}

async function resolveMaintenanceChannel(client: Client, target: MaintenanceTarget): Promise<TextChannel> {
    const channelId = await getManagedChannelId(target);
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel?.type === ChannelType.GuildText) return channel as TextChannel;

    if (channel?.type === ChannelType.GuildCategory) {
        const child = await findTextChannelInCategory(client, target, channel.id);
        if (child) {
            await setManagedChannelId(target, child.id);
            return child;
        }
    }

    const configured = await findTextChannelInCategory(client, target, configuredParentId(target));
    if (configured) {
        await setManagedChannelId(target, configured.id);
        return configured;
    }

    throw new Error(`Maintenance channel for ${target} not found. Last channel id: ${channelId}`);
}

async function recreateChannel(channel: TextChannel, target: MaintenanceTarget): Promise<TextChannel> {
    const oldPosition = channel.rawPosition;
    const parentId = configuredParentId(target) || channel.parentId;
    const topic = channel.topic || undefined;
    const rateLimitPerUser = channel.rateLimitPerUser || 0;
    const nsfw = channel.nsfw;
    const permissionOverwrites = channel.permissionOverwrites.cache.map(overwrite => ({
        id: overwrite.id,
        allow: overwrite.allow,
        deny: overwrite.deny,
        type: overwrite.type
    }));

    markInternalAntiRaidAction('channelCreate', '*');
    const clone = await channel.guild.channels.create({
        name: channel.name,
        type: ChannelType.GuildText,
        topic,
        nsfw,
        rateLimitPerUser,
        parent: parentId || channel.parentId || undefined,
        permissionOverwrites,
        reason: 'Stella monthly channel refresh'
    });

    await clone.setPosition(oldPosition).catch(() => {});
    markInternalAntiRaidAction('channelUpdate', clone.id);
    markInternalAntiRaidAction('channelDelete', channel.id);
    await channel.delete('Stella monthly channel refresh').catch(() => {});
    await setManagedChannelId(target, clone.id);
    return clone;
}

function buildRequestGuideEmbed(target: MaintenanceTarget): EmbedBuilder {
    const isPaid = target === 'requestPaid';
    return new EmbedBuilder()
        .setColor(isPaid ? config.ui.colors.requestPaid : config.ui.colors.requestFree)
        .setTitle(isPaid ? 'Hướng dẫn request có phí' : 'Hướng dẫn request hỗ trợ')
        .setDescription(
            `Kênh đã được làm mới cho tháng này. Đăng đúng format để bài được bot giữ lại.\n\n` +
            (isPaid
                ? '```text\n[Service] Dịch vụ cần thuê\n[Request] Mô tả yêu cầu\n[Budget] Ngân sách\n[Other] Liên hệ/ghi chú optional\n```'
                : '```text\n[Service] Việc cần hỗ trợ\n[Request] Mô tả yêu cầu\n[Other] Liên hệ/ghi chú optional\n```') +
            '\nKhông spam/bump quá đà. Nếu xong việc hãy bấm Hoàn Thành.'
        )
        .setFooter({ text: 'Stella Studio - Monthly reset' })
        .setTimestamp();
}

async function postGuide(channel: TextChannel, target: MaintenanceTarget): Promise<void> {
    if (target === 'serverAds') {
        await channel.send({ embeds: [buildServerAdsGuideEmbed()] });
        return;
    }
    await channel.send({ embeds: [buildRequestGuideEmbed(target)] });
}

export async function clearMaintenanceTarget(client: Client, target: MaintenanceTarget, actorId?: string, period?: string): Promise<number> {
    const channel = await resolveMaintenanceChannel(client, target);

    const oldChannelId = channel.id;
    const refreshed = await recreateChannel(channel, target);
    await postGuide(refreshed, target);

    if (period) {
        await prisma.maintenanceLog.upsert({
            where: { channelId_kind_period: { channelId: refreshed.id, kind: 'monthly-clear', period } },
            update: { actorId },
            create: { channelId: refreshed.id, kind: 'monthly-clear', period, actorId }
        });
    }

    await sendAdminLog(client, {
        title: 'Channel cleared',
        color: '#3498db',
        fields: [
            { name: 'Target', value: target, inline: true },
            { name: 'Old/New', value: `<#${oldChannelId}> -> <#${refreshed.id}>`, inline: true },
            { name: 'Actor', value: actorId ? `<@${actorId}>` : 'Scheduler', inline: true }
        ]
    });

    return 0;
}

export async function runMonthlyMaintenance(client: Client): Promise<void> {
    const { day, period } = currentSaigonDateParts();
    if (day !== '01') return;

    for (const target of ['requestPaid', 'requestFree', 'serverAds'] as MaintenanceTarget[]) {
        const channelId = await getManagedChannelId(target);
        const existing = await prisma.maintenanceLog.findUnique({
            where: { channelId_kind_period: { channelId, kind: 'monthly-clear', period } }
        });
        if (existing) continue;
        await clearMaintenanceTarget(client, target, undefined, period).catch(error => {
            sendAdminLog(client, {
                title: 'Monthly clear failed',
                color: '#e74c3c',
                fields: [
                    { name: 'Target', value: target, inline: true },
                    { name: 'Error', value: String(error) }
                ]
            }).catch(() => {});
        });
    }
}

export function startMaintenanceScheduler(client: Client): void {
    runMonthlyMaintenance(client).catch(() => {});
    setInterval(() => {
        runMonthlyMaintenance(client).catch(() => {});
    }, 60 * 60 * 1000);
}
