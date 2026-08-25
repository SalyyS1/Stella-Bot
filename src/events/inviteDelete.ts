import { Events, Invite } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';

export default {
    name: Events.InviteDelete,
    once: false,
    async execute(invite: Invite) {
        if (!config.invites.enabled) return;
        // Xoá khỏi ảnh chụp để lần diff sau không so với một mã đã chết. Lượt mời đã
        // ghi nhận không bị ảnh hưởng: chúng nằm ở InviteJoin, không phụ thuộc mã
        // còn tồn tại hay không.
        await prisma.inviteCache.deleteMany({ where: { code: invite.code } })
            .catch(error => console.error('[invite] inviteDelete dọn cache lỗi:', error));
    }
};
