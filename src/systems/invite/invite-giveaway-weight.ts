import { EmbedBuilder } from 'discord.js';
import prisma from '../../lib/prisma';
import { config } from '../../config';
import { countVerifiedInvites, getLegacyUses } from './invite-stats';

// Thuật toán quay nằm ở weighted-draw.ts (không import prisma) để test được độc lập.
export { pickWinnersWeighted } from './weighted-draw';

export interface InviteBonusConfig {
    inviteBonusMode: string; // none | all_time | since_start
    inviteWeightPer: number;
    inviteWeightCap: number;
    inviteCountFrom: Date | null;
}

export function isInviteBonusOn(giveaway: InviteBonusConfig): boolean {
    return giveaway.inviteBonusMode === 'all_time' || giveaway.inviteBonusMode === 'since_start';
}

// Số lượt mời được tính cho một người trong một giveaway.
//
// Chế độ since_start so theo `verifiedAt`, KHÔNG phải `joinedAt`. Lý do: cổng chống
// bot mất 24h mới xác nhận một lượt, nên nếu so theo lúc người ta join thì ai mời
// vào ngày cuối giveaway sẽ luôn mất vé — hệ thống tự phạt đúng người mời thật.
// Đổi lại, lượt mời từ trước giveaway mà vừa chín trong giveaway cũng được tính;
// đó là cái giá rẻ hơn.
export async function countInvitesForGiveaway(giveaway: InviteBonusConfig, userId: string): Promise<number> {
    if (giveaway.inviteBonusMode === 'since_start') {
        return countVerifiedInvites(userId, giveaway.inviteCountFrom);
    }
    const [verified, legacy] = await Promise.all([
        countVerifiedInvites(userId),
        getLegacyUses(userId)
    ]);
    return verified + legacy;
}

// Số vé của một người: luôn có 1 vé nền, cộng thêm theo lượt mời nhưng chặn ở trần.
// 1 vé nền là điều làm cho tính năng này là "ưu tiên" chứ không phải "chỉ người mời
// nhiều mới có cơ hội".
export async function computeEntryWeight(giveaway: InviteBonusConfig, userId: string): Promise<number> {
    if (!isInviteBonusOn(giveaway)) return 1;
    const invites = await countInvitesForGiveaway(giveaway, userId);
    const bonus = Math.min(Math.max(0, giveaway.inviteWeightCap), invites * Math.max(0, giveaway.inviteWeightPer));
    return 1 + bonus;
}

export function describeInviteBonus(giveaway: InviteBonusConfig): string | null {
    if (!isInviteBonusOn(giveaway)) return null;
    const scope = giveaway.inviteBonusMode === 'since_start'
        ? 'lượt mời tính **từ lúc giveaway mở**'
        : 'lượt mời **từ trước tới giờ**';
    return `Mỗi ${scope} được **+${giveaway.inviteWeightPer} vé** (tối đa +${giveaway.inviteWeightCap}). ` +
        'Ai cũng có 1 vé nền — mời nhiều là **ưu tiên**, không phải chắc trúng.';
}

export interface WeightedCandidate {
    userId: string;
    weight: number;
}

// Nút "Tỷ lệ của tôi". Hiện số thật thay vì hứa hẹn mơ hồ: người ta cần thấy mình
// có bao nhiêu phần trăm để quyết có đi mời thêm hay không.
export async function buildOddsReply(giveawayId: number, userId: string) {
    const giveaway = await prisma.giveaway.findUnique({ where: { id: giveawayId } });
    if (!giveaway) return { content: `${config.ui.emojis.error} Không tìm thấy giveaway này.` };

    const entries = await prisma.giveawayEntry.findMany({ where: { giveawayId } });
    const joined = entries.find(entry => entry.userId === userId);
    const myWeight = await computeEntryWeight(giveaway, userId);

    // Số vé lưu ở DB là số lúc tham gia; số quay thật được tính lại lúc kết thúc,
    // nên phần trăm ở đây dùng số MỚI của người xem và số đã lưu của người khác.
    const othersTotal = entries
        .filter(entry => entry.userId !== userId)
        .reduce((sum, entry) => sum + Math.max(1, entry.entries), 0);
    const total = othersTotal + (joined ? myWeight : 0);
    const percent = joined && total > 0 ? (myWeight / total) * 100 : 0;

    const invites = isInviteBonusOn(giveaway) ? await countInvitesForGiveaway(giveaway, userId) : 0;

    const embed = new EmbedBuilder()
        .setColor('#f1c40f')
        .setTitle(`Tỷ lệ của bạn · Giveaway #${giveawayId}`)
        .setDescription(joined
            ? `Bạn có **${myWeight}** vé trong tổng **${total}** vé ≈ **${percent.toFixed(1)}%** cho mỗi suất winner.`
            : `Bạn **chưa tham gia**. Tham gia ngay thì bạn sẽ có **${myWeight}** vé.`)
        .setFooter({ text: 'Giveaway quay nhiều winner thì cơ hội thực tế cao hơn con số này.' });

    if (isInviteBonusOn(giveaway)) {
        embed.addFields({
            name: 'Lượt mời được tính',
            value: `**${invites}** lượt → +${Math.min(giveaway.inviteWeightCap, invites * giveaway.inviteWeightPer)} vé ` +
                `(trần +${giveaway.inviteWeightCap})`,
            inline: false
        });
    } else {
        embed.addFields({
            name: 'Ưu tiên theo lượt mời',
            value: 'Giveaway này quay đều — mọi người 1 vé như nhau.',
            inline: false
        });
    }

    return { embeds: [embed] };
}
