import prisma from '../../lib/prisma';

// Truy cập DB cho role menu. Tách khỏi phần dựng giao diện và phần xử lý bấm nút để
// mỗi file chỉ có một lý do phải sửa.

export type RoleMenuMode = 'multi' | 'unique' | 'verify';
export type RoleMenuStyle = 'button' | 'select';

export interface CreateMenuInput {
    channelId: string;
    title: string;
    description: string;
    mode: RoleMenuMode;
    style: RoleMenuStyle;
    createdBy: string;
}

export async function createMenu(input: CreateMenuInput) {
    return prisma.roleMenu.create({ data: input });
}

export async function getMenu(id: number) {
    return prisma.roleMenu.findUnique({
        where: { id },
        include: { options: { orderBy: { position: 'asc' } } }
    });
}

export async function getMenuByMessage(messageId: string) {
    return prisma.roleMenu.findUnique({
        where: { messageId },
        include: { options: { orderBy: { position: 'asc' } } }
    });
}

export async function listMenus() {
    return prisma.roleMenu.findMany({
        orderBy: { id: 'asc' },
        include: { options: { orderBy: { position: 'asc' } } }
    });
}

export async function addOption(input: {
    menuId: number;
    roleId: string;
    label: string;
    emoji?: string | null;
    description?: string | null;
}) {
    const count = await prisma.roleMenuOption.count({ where: { menuId: input.menuId } });
    return prisma.roleMenuOption.create({
        data: {
            menuId: input.menuId,
            roleId: input.roleId,
            label: input.label,
            emoji: input.emoji || null,
            description: input.description || null,
            position: count
        }
    });
}

export async function removeOption(menuId: number, roleId: string) {
    const result = await prisma.roleMenuOption.deleteMany({ where: { menuId, roleId } });
    return result.count;
}

export async function setMenuMessage(id: number, channelId: string, messageId: string) {
    return prisma.roleMenu.update({ where: { id }, data: { channelId, messageId } });
}

export async function deleteMenu(id: number) {
    // Option bị xoá theo nhờ `onDelete: Cascade` trong schema.
    return prisma.roleMenu.delete({ where: { id } });
}
