import prisma from '../../lib/prisma';

// Truy cập DB cho phòng voice tạm.
//
// Vì sao phòng đang mở phải nằm ở DB chứ không chỉ trong RAM: bot restart giữa lúc có
// 5 phòng đang sống thì cần biết kênh nào là của mình để dọn. Không có bảng này thì
// những kênh đó thành rác vĩnh viễn và không ai dám xoá vì không chắc của ai.

export async function createHub(input: {
    channelId: string;
    categoryId: string | null;
    nameTemplate: string;
    userLimit: number;
}) {
    return prisma.tempVoiceHub.create({ data: input });
}

export async function getHub(channelId: string) {
    return prisma.tempVoiceHub.findUnique({ where: { channelId } }).catch(() => null);
}

export async function listHubs() {
    return prisma.tempVoiceHub.findMany().catch(() => []);
}

export async function deleteHub(channelId: string) {
    return prisma.tempVoiceHub.delete({ where: { channelId } });
}

export async function createRoom(input: { channelId: string; hubId: string; ownerId: string }) {
    return prisma.tempVoiceChannel.create({ data: input });
}

export async function getRoom(channelId: string) {
    return prisma.tempVoiceChannel.findUnique({ where: { channelId } }).catch(() => null);
}

export async function listRooms() {
    return prisma.tempVoiceChannel.findMany({ orderBy: { createdAt: 'asc' } }).catch(() => []);
}

export async function countRooms() {
    return prisma.tempVoiceChannel.count().catch(() => 0);
}

export async function countRoomsByOwner(ownerId: string) {
    return prisma.tempVoiceChannel.count({ where: { ownerId } }).catch(() => 0);
}

export async function updateRoom(
    channelId: string,
    data: Partial<{ ownerId: string; locked: boolean; hidden: boolean }>
) {
    return prisma.tempVoiceChannel.update({ where: { channelId }, data }).catch(() => null);
}

export async function deleteRoom(channelId: string) {
    return prisma.tempVoiceChannel.delete({ where: { channelId } }).catch(() => null);
}
