import { Guild, TextChannel } from 'discord.js';
import { buildMenuComponents, buildMenuEmbed } from './rolemenu-render';
import { getMenu, setMenuMessage, type RoleMenuMode, type RoleMenuStyle } from './rolemenu-store';

// Đăng (hoặc cập nhật) một role menu ra kênh.
//
// Tách riêng vì cả `/rolemenu post` và `/verify setup` đều cần, và vì quy tắc "sửa tin
// cũ thay vì đăng tin mới" là thứ dễ làm sai: đăng lại mỗi lần sẽ để lại menu cũ trong
// kênh mà người ta vẫn bấm được, và bấm vào đó thì role vẫn được cấp — hai menu song
// song, không ai biết cái nào là thật.

export async function publishMenu(guild: Guild, menuId: number, targetChannelId?: string): Promise<string> {
    const menu = await getMenu(menuId);
    if (!menu) throw new Error(`Không tìm thấy role menu #${menuId}.`);
    if (!menu.options.length) throw new Error('Menu này chưa có lựa chọn nào. Thêm bằng `/rolemenu add` trước.');

    const channelId = targetChannelId || menu.channelId;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) throw new Error(`Không gửi được vào <#${channelId}>.`);

    const payload = {
        embeds: [buildMenuEmbed(menu as any, guild)],
        components: buildMenuComponents(menu as any, guild) as any,
        // Nội dung menu do admin nhập; không cho nó ping ai khi đăng.
        allowedMentions: { parse: [] as const }
    };

    // Đổi kênh thì tin cũ ở kênh cũ phải biến mất, nếu không server có hai menu sống.
    if (menu.messageId && menu.channelId !== channelId) {
        const oldChannel = await guild.channels.fetch(menu.channelId).catch(() => null);
        if (oldChannel?.isTextBased()) {
            await (oldChannel as TextChannel).messages.fetch(menu.messageId)
                .then(old => old.delete())
                .catch(() => {});
        }
    } else if (menu.messageId) {
        const edited = await (channel as TextChannel).messages.fetch(menu.messageId)
            .then(existing => existing.edit(payload))
            .catch(() => null);
        if (edited) {
            await setMenuMessage(menuId, channelId, edited.id);
            return edited.url;
        }
        // Tin cũ đã bị xoá tay → rơi xuống nhánh gửi mới bên dưới.
    }

    const sent = await (channel as TextChannel).send(payload);
    await setMenuMessage(menuId, channelId, sent.id);
    return sent.url;
}

/** Xoá tin nhắn menu đã đăng (dùng khi `/rolemenu delete`). */
export async function unpublishMenu(guild: Guild, channelId: string, messageId: string | null): Promise<void> {
    if (!messageId) return;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    await (channel as TextChannel).messages.fetch(messageId)
        .then(message => message.delete())
        .catch(() => {});
}

export type { RoleMenuMode, RoleMenuStyle };
