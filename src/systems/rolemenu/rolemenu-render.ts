import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Guild, StringSelectMenuBuilder } from 'discord.js';
import { config } from '../../config';
import type { RoleMenuMode, RoleMenuStyle } from './rolemenu-store';

// Dựng embed + component cho một role menu.
//
// customId mang theo menuId và roleId, nhưng người xử lý KHÔNG được tin chúng: customId
// nằm trong tay client. Ở đây chỉ dựng; việc đối chiếu roleId có thật thuộc menu đó hay
// không nằm ở rolemenu-handler.ts.

export interface RenderOption {
    roleId: string;
    label: string;
    emoji: string | null;
    description: string | null;
}

export interface RenderInput {
    id: number;
    title: string;
    description: string;
    mode: RoleMenuMode;
    style: RoleMenuStyle;
    options: RenderOption[];
}

const MODE_HINT: Record<RoleMenuMode, string> = {
    multi: 'Chọn bao nhiêu tuỳ thích · bấm lại để bỏ',
    unique: 'Chỉ giữ được **một** lựa chọn trong menu này',
    verify: 'Bấm để nhận quyền vào server'
};

/** Gắn emoji an toàn: emoji sai định dạng không được làm hỏng cả menu. */
function applyEmoji<T extends ButtonBuilder>(builder: T, emoji: string | null): T {
    if (!emoji) return builder;
    try {
        builder.setEmoji(emoji);
    } catch {
        // Bỏ qua: mất một icon còn hơn menu không đăng được.
    }
    return builder;
}

export function buildMenuEmbed(input: RenderInput, guild: Guild): EmbedBuilder {
    const lines = input.options.map(option => {
        const role = guild.roles.cache.get(option.roleId);
        const suffix = role ? `<@&${option.roleId}>` : '*(role đã bị xoá)*';
        return `${option.emoji ? `${option.emoji} ` : ''}**${option.label}** — ${suffix}` +
            (option.description ? `\n   ${option.description}` : '');
    });

    return new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(input.title)
        .setDescription(
            `${input.description}\n\n${lines.join('\n') || '*Chưa có lựa chọn nào.*'}\n\n` +
            `-# ${MODE_HINT[input.mode]}`
        )
        .setFooter({ text: `Role menu #${input.id}` });
}

export function buildMenuComponents(input: RenderInput, guild: Guild) {
    // Role đã bị xoá khỏi server thì bỏ khỏi component: để lại thì người ta bấm vào một
    // nút chỉ có thể báo lỗi.
    const options = input.options.filter(option => guild.roles.cache.has(option.roleId));
    if (!options.length) return [];

    if (input.style === 'select') {
        const select = new StringSelectMenuBuilder()
            .setCustomId(`rolemenu_sel_${input.id}`)
            .setPlaceholder('Chọn role của bạn...')
            // multi: bỏ hết lựa chọn = gỡ hết role, nên cho phép chọn 0.
            // unique/verify: bắt buộc đúng một lượt chọn.
            .setMinValues(input.mode === 'multi' ? 0 : 1)
            .setMaxValues(input.mode === 'multi' ? options.length : 1)
            .addOptions(options.slice(0, 25).map(option => ({
                label: option.label.slice(0, 100),
                value: option.roleId,
                description: option.description?.slice(0, 100) || undefined,
                emoji: option.emoji || undefined
            })));
        return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
    }

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (const option of options.slice(0, config.roleMenu.maxOptions)) {
        if (!rows.length || rows[rows.length - 1].components.length === 5) {
            rows.push(new ActionRowBuilder<ButtonBuilder>());
        }
        rows[rows.length - 1].addComponents(
            applyEmoji(
                new ButtonBuilder()
                    .setCustomId(`rolemenu_btn_${input.id}_${option.roleId}`)
                    .setLabel(option.label.slice(0, 80))
                    .setStyle(input.mode === 'verify' ? ButtonStyle.Success : ButtonStyle.Secondary),
                option.emoji
            )
        );
    }
    return rows;
}
