import prisma from '../../lib/prisma';

// Truy cập DB cho ticket. Tách khỏi phần dựng kênh/quyền để mỗi file chỉ có một lý do sửa.

export async function getTicketConfig(guildId: string) {
    return prisma.ticketConfig.findUnique({ where: { guildId } }).catch(() => null);
}

export async function saveTicketConfig(guildId: string, data: {
    categoryId?: string | null;
    staffRoleId?: string | null;
    panelChannelId?: string | null;
    panelMessageId?: string | null;
    maxPerUser?: number;
}) {
    return prisma.ticketConfig.upsert({
        where: { guildId },
        update: data,
        create: { guildId, ...data }
    });
}

export async function createTicketRow(input: { channelId: string; openerId: string; topic: string }) {
    return prisma.ticket.create({ data: input });
}

export async function getTicketByChannel(channelId: string) {
    return prisma.ticket.findUnique({ where: { channelId } }).catch(() => null);
}

export async function countOpenTickets(openerId: string) {
    return prisma.ticket.count({ where: { openerId, closedAt: null } }).catch(() => 0);
}

export async function listOpenTickets() {
    return prisma.ticket.findMany({ where: { closedAt: null }, orderBy: { id: 'asc' } }).catch(() => []);
}

export async function claimTicket(channelId: string, staffId: string) {
    return prisma.ticket.update({ where: { channelId }, data: { claimedBy: staffId } }).catch(() => null);
}

export async function closeTicketRow(channelId: string, closedBy: string) {
    return prisma.ticket.update({
        where: { channelId },
        data: { closedBy, closedAt: new Date() }
    }).catch(() => null);
}

/** Ticket của kênh đã bị xoá tay → đóng row để `/ticket list` không giữ rác. */
export async function reconcileTickets(existingChannelIds: Set<string>): Promise<number> {
    const open = await listOpenTickets();
    let cleaned = 0;
    for (const ticket of open) {
        if (existingChannelIds.has(ticket.channelId)) continue;
        await closeTicketRow(ticket.channelId, 'system');
        cleaned++;
    }
    return cleaned;
}
