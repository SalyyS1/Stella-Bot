import { Guild, PermissionFlagsBits } from 'discord.js';
import { sendAdminLog } from '../../utils/adminLog';

// Kiểm quyền một lần lúc bot lên.
//
// Vì sao đáng có: thiếu quyền ở hai chỗ này KHÔNG gây lỗi, chỉ làm dữ liệu sai một
// cách im lặng — và đó là kiểu hỏng tệ nhất.
//   - Thiếu Manage Server: không fetch được invite ⇒ mọi lượt join thành "không rõ
//     người mời" và bị dồn về chủ server.
//   - Thiếu View Audit Log: event audit không bắn ⇒ MỌI tin bị mod xoá đều hiện là
//     "tác giả tự xoá". Log vẫn đầy đủ và trông đáng tin, chỉ là nói sai người.
export async function runPermissionPreflight(guild: Guild): Promise<string[]> {
    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!me) return [];

    const missing: string[] = [];
    if (!me.permissions.has(PermissionFlagsBits.ManageGuild)) {
        missing.push('**Manage Server** — không đọc được danh sách invite, hệ thống mời sẽ không quy được ai mời ai.');
    }
    if (!me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
        missing.push('**View Audit Log** — log tin nhắn sẽ ghi mọi lượt xoá là "tác giả tự xoá", kể cả khi mod xoá.');
    }
    if (!me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        missing.push('**Moderate Members** — bot không trả lại được role kỷ luật khi người bị mute vào lại.');
    }

    if (missing.length) {
        await sendAdminLog(guild.client, {
            title: 'Bot đang thiếu quyền',
            color: '#e67e22',
            description: `${missing.join('\n')}\n\nCấp quyền trong Server Settings → Roles → role của bot.`
        }).catch(() => {});
    }

    return missing;
}
