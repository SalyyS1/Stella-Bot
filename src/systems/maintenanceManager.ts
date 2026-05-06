import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { sendAdminLog } from '../utils/adminLog';
import { buildServerAdsGuideEmbed } from './serverAdsManager';

export type MaintenanceTarget = 'requestPaid' | 'requestFree' | 'serverAds';

const targetChannelIds: Record<MaintenanceTarget, string> = {
    requestPaid: config.channels.requestPaid,
    requestFree: config.channels.requestFree,
    serverAds: config.channels.serverAds
};

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

async function clearChannelMessages(channel: TextChannel): Promise<number> {
    let deleted = 0;
    for (let i = 0; i < 10; i++) {
        const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        if (!messages || messages.size === 0) break;
        const deletable = messages.filter(message => !message.pinned);
        if (deletable.size === 0) break;
        const result = await channel.bulkDelete(deletable, true).catch(() => null);
        deleted += result?.size || 0;
        if (messages.size < 100) break;
    }
    return deleted;
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
    const channelId = targetChannelIds[target];
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) throw new Error(`Channel ${channelId} not found`);

    const deleted = await clearChannelMessages(channel as TextChannel);
    await postGuide(channel as TextChannel, target);

    if (period) {
        await prisma.maintenanceLog.upsert({
            where: { channelId_kind_period: { channelId, kind: 'monthly-clear', period } },
            update: { actorId },
            create: { channelId, kind: 'monthly-clear', period, actorId }
        });
    }

    await sendAdminLog(client, {
        title: 'Channel cleared',
        color: '#3498db',
        fields: [
            { name: 'Target', value: target, inline: true },
            { name: 'Deleted', value: `${deleted}`, inline: true },
            { name: 'Actor', value: actorId ? `<@${actorId}>` : 'Scheduler', inline: true }
        ]
    });

    return deleted;
}

export async function runMonthlyMaintenance(client: Client): Promise<void> {
    const { day, period } = currentSaigonDateParts();
    if (day !== '01') return;

    for (const target of Object.keys(targetChannelIds) as MaintenanceTarget[]) {
        const channelId = targetChannelIds[target];
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
