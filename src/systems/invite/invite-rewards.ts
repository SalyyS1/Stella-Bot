import { Client } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';
import { adjustScoinTx } from '../scoinManager';
import { countVerifiedInvites } from './invite-stats';

export interface InviteRewardResult {
    scoinPaid: number;
    dmSent: boolean;
}

// Trả thưởng cho một lượt mời VỪA chuyển sang VERIFIED.
//
// Chốt idempotent nằm ở chỗ gọi, không nằm ở đây: invite-verification chỉ gọi hàm
// này khi câu updateMany đổi trạng thái trả về đúng 1 dòng. Nhờ vậy bot chết giữa
// lúc flip trạng thái và lúc cộng xu thì lần quét sau không vào lại nhánh này —
// không có lượt nào được trả xu hai lần.
//
// Chỉ trả xu cho source === 'INVITE'. Lượt vào qua vanity/không rõ nguồn vẫn được
// ghi công theo chốt của Saly (dồn về chủ server) nhưng KHÔNG sinh xu: không ai
// thực sự mời những người đó, nên trả xu cho nó là in tiền theo lượng người vào
// server chứ không theo công sức mời.
export async function awardInviteReward(
    client: Client,
    inviterId: string,
    invitedId: string,
    source: string
): Promise<InviteRewardResult> {
    let scoinPaid = 0;

    if (source === 'INVITE' && config.invites.scoinPerInvite > 0) {
        const amount = config.invites.scoinPerInvite;
        try {
            await prisma.$transaction(tx => adjustScoinTx(
                tx,
                inviterId,
                amount,
                `Mời thành viên mới (${invitedId})`,
                'invite:verified',
                `invite:${invitedId}`
            ));
            scoinPaid = amount;
        } catch (error) {
            console.error(`[invite] không trả được Scoin cho ${inviterId}:`, error);
        }
    }

    // Người mời cần biết cổng 24h đã qua, nếu không thì lượt mời trông như bị mất.
    // Đây là DM riêng, không phải thông báo công khai (Saly đã bỏ phần chúc mừng
    // ở kênh chat). Bị chặn DM thì bỏ qua — không đáng để log ồn.
    let dmSent = false;
    try {
        const total = await countVerifiedInvites(inviterId);
        const user = await client.users.fetch(inviterId);
        const scoinLine = scoinPaid > 0 ? ` và **+${scoinPaid} Scoin**` : '';
        await user.send(
            `${config.ui.emojis.success} <@${invitedId}> đã ở lại Stella qua ${config.invites.stayHours}h ` +
            `và làm xong bước chọn lĩnh vực — bạn được **+1 lượt mời**${scoinLine}.\n` +
            `Tổng lượt mời đã tính của bạn: **${total}**.`
        );
        dmSent = true;
    } catch {
        // người mời chặn DM hoặc đã rời server
    }

    return { scoinPaid, dmSent };
}
