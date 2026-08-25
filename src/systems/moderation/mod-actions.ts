import { Guild, GuildMember, PermissionFlagsBits, User } from 'discord.js';
import { config } from '../../config';
import { createModCase, ModCaseKind } from './mod-case-manager';
import { markInternalAntiRaidAction } from '../antiRaidManager';

export interface ActorContext {
    guild: Guild;
    actor: GuildMember;
}

// Kiểm tra một mod có được phép ra tay lên một thành viên hay không.
//
// Đây là chốt bảo mật quan trọng nhất của cả bộ lệnh kiểm duyệt: Discord KHÔNG tự
// kiểm thứ bậc khi hành động do BOT thực hiện. Bot chỉ cần role cao hơn mục tiêu là
// ban được, nên nếu không tự kiểm thì một mod quyền thấp có thể nhờ bot ban admin —
// leo thang quyền bằng chính con bot của server.
//
// Thứ tự kiểm là có chủ ý: mục tiêu đặc biệt (chủ server, chính mình, bot) trước,
// rồi thứ bậc của mod, rồi mới tới khả năng của bot. Lỗi trả về phải nói rõ lý do
// để mod không tưởng là bot hỏng.
export function assertCanModerate(context: ActorContext, target: GuildMember, action: string): void {
    const { guild, actor } = context;

    if (target.id === actor.id) throw new Error(`Không thể tự ${action} chính mình.`);
    if (target.id === guild.client.user?.id) throw new Error(`Không thể ${action} chính Stella.`);
    if (target.id === guild.ownerId) throw new Error('Không thể ra tay với chủ server.');
    if (target.user.bot && action !== 'kick' && action !== 'ban') {
        throw new Error('Lệnh này không dùng cho bot.');
    }

    const actorIsOwner = actor.id === guild.ownerId;
    if (!actorIsOwner) {
        // So sánh vị trí role cao nhất. Bằng nhau cũng bị chặn: hai mod cùng cấp
        // trị nhau qua bot là cách một tài khoản mod bị chiếm dùng để dọn cả team.
        if (target.roles.highest.position >= actor.roles.highest.position) {
            throw new Error('Thành viên này có role ngang hoặc cao hơn bạn — bạn không có quyền xử.');
        }
        if (target.permissions.has(PermissionFlagsBits.Administrator)) {
            throw new Error('Thành viên này có quyền Administrator; chỉ chủ server xử được.');
        }
    }

    const me = guild.members.me;
    if (!me) throw new Error('Không đọc được thông tin bot trong server.');
    if (target.roles.highest.position >= me.roles.highest.position) {
        throw new Error('Role của Stella thấp hơn thành viên này. Kéo role của Stella lên cao hơn trong Server Settings → Roles.');
    }
}

// DM trước khi ra tay: sau khi kick/ban thì không còn kênh nào để nói lý do, và một
// hình phạt không lý do là thứ sinh ra drama nhiều nhất.
async function notifyTarget(target: GuildMember, action: string, reason: string, extra?: string): Promise<boolean> {
    try {
        await target.send(
            `${config.ui.emojis.appeal} Bạn vừa bị **${action}** ở **${target.guild.name}**.\n` +
            `Lý do: ${reason}\n` +
            (extra ? `${extra}\n` : '') +
            'Nếu bạn thấy quyết định này không đúng, hãy nhắn cho mod để xem lại.'
        );
        return true;
    } catch {
        return false;
    }
}

export interface ModActionResult {
    caseId: number;
    dmSent: boolean;
}

async function record(
    context: ActorContext,
    targetId: string,
    kind: ModCaseKind,
    reason: string,
    dmSent: boolean
): Promise<ModActionResult> {
    const record = await createModCase({
        targetId,
        actorId: context.actor.id,
        kind,
        reason,
        notifyClient: context.guild.client
    });
    return { caseId: record.id, dmSent };
}

export async function banMember(
    context: ActorContext,
    target: GuildMember,
    reason: string,
    deleteMessageDays = 0
): Promise<ModActionResult> {
    assertCanModerate(context, target, 'ban');
    const dmSent = await notifyTarget(target, 'ban', reason);
    // Đăng ký hành động nội bộ để anti-raid không tính lượt ban này là dấu hiệu raid.
    markInternalAntiRaidAction('memberBan', target.id);
    await target.ban({
        reason: `${context.actor.user.tag}: ${reason}`,
        deleteMessageSeconds: Math.min(7, Math.max(0, deleteMessageDays)) * 86_400
    });
    return record(context, target.id, 'BAN', reason, dmSent);
}

export async function kickMember(context: ActorContext, target: GuildMember, reason: string): Promise<ModActionResult> {
    assertCanModerate(context, target, 'kick');
    const dmSent = await notifyTarget(target, 'kick', reason, 'Bạn có thể vào lại server nếu vẫn còn link mời.');
    markInternalAntiRaidAction('memberKick', target.id);
    await target.kick(`${context.actor.user.tag}: ${reason}`);
    return record(context, target.id, 'KICK', reason, dmSent);
}

// Timeout dùng cơ chế của Discord chứ không phải role mute tự dựng: nó chặn cả chat,
// voice và reaction, và không thể né bằng cách rời server rồi vào lại.
export async function timeoutMember(
    context: ActorContext,
    target: GuildMember,
    durationMs: number,
    reason: string
): Promise<ModActionResult> {
    assertCanModerate(context, target, 'timeout');
    if (durationMs < 60_000 || durationMs > 28 * 86_400_000) {
        throw new Error('Thời lượng timeout phải từ 1 phút đến 28 ngày (giới hạn của Discord).');
    }
    if (!target.moderatable) throw new Error('Stella không có quyền timeout thành viên này.');

    const until = new Date(Date.now() + durationMs);
    const dmSent = await notifyTarget(
        target,
        'timeout',
        reason,
        `Hết hạn: <t:${Math.floor(until.getTime() / 1000)}:f>`
    );
    await target.timeout(durationMs, `${context.actor.user.tag}: ${reason}`);
    return record(context, target.id, 'TIMEOUT', `${reason} (tới ${until.toISOString()})`, dmSent);
}

export async function untimeoutMember(context: ActorContext, target: GuildMember, reason: string): Promise<ModActionResult> {
    if (!target.isCommunicationDisabled()) throw new Error('Thành viên này không đang bị timeout.');
    if (!target.moderatable) throw new Error('Stella không có quyền gỡ timeout cho thành viên này.');
    await target.timeout(null, `${context.actor.user.tag}: ${reason}`);
    return record(context, target.id, 'UNBAN', `Gỡ timeout: ${reason}`, false);
}

// Softban = ban rồi unban ngay, để xoá tin nhắn gần đây mà vẫn cho người ta vào lại.
export async function softbanMember(
    context: ActorContext,
    target: GuildMember,
    reason: string,
    deleteMessageDays = 1
): Promise<ModActionResult> {
    assertCanModerate(context, target, 'softban');
    const dmSent = await notifyTarget(target, 'softban (xoá tin nhắn)', reason, 'Bạn vào lại server được ngay.');
    markInternalAntiRaidAction('memberBan', target.id);
    await target.ban({
        reason: `softban ${context.actor.user.tag}: ${reason}`,
        deleteMessageSeconds: Math.min(7, Math.max(1, deleteMessageDays)) * 86_400
    });
    await context.guild.bans.remove(target.id, `softban tự gỡ: ${reason}`);
    return record(context, target.id, 'KICK', `Softban: ${reason}`, dmSent);
}

export async function unbanUser(context: ActorContext, user: User, reason: string): Promise<ModActionResult> {
    const ban = await context.guild.bans.fetch(user.id).catch(() => null);
    if (!ban) throw new Error('Người này không nằm trong danh sách ban.');
    await context.guild.bans.remove(user.id, `${context.actor.user.tag}: ${reason}`);
    return record(context, user.id, 'UNBAN', reason, false);
}
