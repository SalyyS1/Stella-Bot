import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Embed,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import { config } from '../../config';

// Bài tự quảng bá trong kênh #portfolio: dựng modal và đọc lại nội dung cũ từ embed.
//
// Vì sao đọc ngược từ embed thay vì thêm bảng DB: bài portfolio KHÔNG có row nào trong DB —
// nó chỉ là một tin nhắn embed do người dùng tự gõ. Thêm bảng chỉ để sửa bài là thêm một
// nguồn sự thật thứ hai phải đồng bộ với tin nhắn, trong khi chính tin nhắn đã đủ. Đổi lại:
// nhãn field trở thành thứ không được đổi tuỳ tiện, nên việc khớp field đi qua đúng một hàm
// ở đây và có test.

export const PORTFOLIO_EDIT_PREFIX = 'pfedit_';

export interface PortfolioFields {
    name: string;
    experience: string;
    service: string;
    portfolioLink: string;
    contact: string;
}

// Khớp theo TỪ KHOÁ trong nhãn, không khớp nguyên chuỗi: nhãn thật có emoji đứng trước
// ("<:customer:...> Tên / Tuổi") và emoji đổi được qua config, còn phần chữ thì không.
const FIELD_MATCHERS: { key: keyof PortfolioFields; test: (label: string) => boolean }[] = [
    { key: 'name', test: label => label.includes('tên') },
    { key: 'experience', test: label => label.includes('kinh nghiệm') },
    { key: 'service', test: label => label.includes('dịch vụ') },
    { key: 'portfolioLink', test: label => label.includes('portfolio') },
    { key: 'contact', test: label => label.includes('liên hệ') }
];

/** Bỏ phần trang trí quanh giá trị field để lấy lại đúng chữ người dùng đã gõ. */
function unwrap(value: string): string {
    return value
        .replace(/^```[a-z]*\n?/i, '')
        .replace(/\n?```$/, '')
        .replace(/^\*\*|\*\*$/g, '')
        .trim();
}

/**
 * Embed bài portfolio -> nội dung từng ô. Field thiếu thì trả chuỗi rỗng chứ không ném:
 * bài cũ đăng bằng phiên bản trước có thể thiếu field, và người dùng vẫn nên sửa được.
 */
export function readPortfolioEmbed(embed: Embed | null | undefined): PortfolioFields {
    const empty: PortfolioFields = { name: '', experience: '', service: '', portfolioLink: '', contact: '' };
    if (!embed?.fields?.length) return empty;

    for (const field of embed.fields) {
        const label = field.name.toLowerCase();
        const matcher = FIELD_MATCHERS.find(entry => entry.test(label));
        if (matcher) empty[matcher.key] = unwrap(field.value);
    }
    return empty;
}

/**
 * Modal đăng/sửa portfolio. `values` rỗng = đăng mới; có giá trị = sửa, và mỗi ô được điền
 * sẵn nội dung cũ — bắt người ta gõ lại cả 5 ô chỉ để đổi một dòng giá là lý do người ta
 * đăng bài mới thay vì sửa.
 */
export function buildPortfolioModal(customId: string, values?: Partial<PortfolioFields>): ModalBuilder {
    const modal = new ModalBuilder()
        .setCustomId(customId)
        .setTitle(values ? 'Sửa bài quảng bá' : 'Quảng Bá Bản Thân');

    const inputs: { id: string; label: string; max: number; value?: string }[] = [
        { id: 'name', label: 'Tên/Tuổi', max: 100, value: values?.name },
        { id: 'experience', label: 'Kinh nghiệm', max: 100, value: values?.experience },
        { id: 'service', label: 'Dịch vụ', max: 500, value: values?.service },
        { id: 'portfolio_link', label: 'Link Sản Phẩm', max: 1000, value: values?.portfolioLink },
        { id: 'contact', label: 'Liên hệ', max: 500, value: values?.contact }
    ];

    modal.addComponents(inputs.map(input => {
        const builder = new TextInputBuilder()
            .setCustomId(input.id)
            .setLabel(input.label)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(input.max)
            .setRequired(true);
        // setValue với chuỗi rỗng bị Discord từ chối, nên chỉ đặt khi thật sự có nội dung.
        // Cắt theo maxLength: bài cũ dài hơn trần hiện tại thì modal sẽ không mở được.
        if (input.value) builder.setValue(input.value.slice(0, input.max));
        return new ActionRowBuilder<TextInputBuilder>().addComponents(builder);
    }));

    return modal;
}

/**
 * Nút dưới bài portfolio: Bump (đăng lại lên top) và Sửa.
 *
 * Nút Bump giữ nguyên customId cũ `bump_<userId>` để bài đã đăng từ trước vẫn bấm được.
 * Nút Sửa mang messageId vì nó phải sửa ĐÚNG tin nhắn đó — một người đăng nhiều bài thì
 * userId không đủ để biết sửa bài nào.
 */
export function portfolioPostButtons(userId: string, messageId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`bump_${userId}`)
            .setLabel('Bump Bài')
            .setStyle(ButtonStyle.Primary)
            .setEmoji(config.ui.emojis.bump),
        new ButtonBuilder()
            .setCustomId(`${PORTFOLIO_EDIT_PREFIX}${messageId}`)
            .setLabel('Sửa bài')
            .setStyle(ButtonStyle.Secondary)
    );
}

/** `pfedit_<messageId>` -> messageId. null nếu không phải nút sửa portfolio. */
export function parsePortfolioEditId(customId: string): string | null {
    if (!customId.startsWith(PORTFOLIO_EDIT_PREFIX)) return null;
    const id = customId.slice(PORTFOLIO_EDIT_PREFIX.length);
    return /^\d{5,25}$/.test(id) ? id : null;
}
