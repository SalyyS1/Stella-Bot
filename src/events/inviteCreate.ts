import { Events, Invite } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';

export default {
    name: Events.InviteCreate,
    once: false,
    async execute(invite: Invite) {
        if (!config.invites.enabled) return;
        // Ghi mã mới ngay khi được tạo. Không có bước này thì lần đầu ai đó dùng mã
        // đó sẽ trông như "mã lạ có 1 lượt" và phải suy đoán thay vì biết chắc.
        await prisma.inviteCache.upsert({
            where: { code: invite.code },
            update: {
                inviterId: invite.inviterId ?? invite.inviter?.id ?? null,
                uses: invite.uses ?? 0,
                maxUses: invite.maxUses ?? 0,
                expiresAt: invite.expiresAt ?? null
            },
            create: {
                code: invite.code,
                inviterId: invite.inviterId ?? invite.inviter?.id ?? null,
                uses: invite.uses ?? 0,
                maxUses: invite.maxUses ?? 0,
                expiresAt: invite.expiresAt ?? null
            }
        }).catch(error => console.error('[invite] inviteCreate lưu cache lỗi:', error));
    }
};
