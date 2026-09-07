import { GuildOnboardingPromptType } from 'discord.js';

// Đẩy một role menu của Stella vào màn hình Onboarding của Discord.
//
// Vì sao đáng: `/rolemenu` là một tin nhắn trong một kênh người mới phải tự tìm. Onboarding
// prompt nằm NGAY trong luồng join, trước khi họ vào server — tỉ lệ hoàn thành cao hơn hẳn.
// Cùng một danh sách role, hai bề mặt hiển thị; `/rolemenu` vẫn là nguồn sự thật duy nhất.
//
// File này thuần (không gọi API) để test được: phần dựng payload chính là phần dễ sai và
// hậu quả thì im lặng — ghi đè nhầm là xoá mất prompt admin đã dựng tay.

export interface MenuOptionInput {
    roleId: string;
    label: string;
    description?: string | null;
    emoji?: string | null;
}

export interface MenuInput {
    id: number;
    title: string;
    mode: string;
    options: MenuOptionInput[];
}

export interface ExistingPrompt {
    id: string;
    title: string;
}

// Trần của Discord: 50 prompt mỗi guild, 50 option mỗi prompt. Nhưng onboarding là màn hình
// người mới phải đọc — 25 lựa chọn đã là quá nhiều để ai đó đọc hết, nên chặn ở đó.
export const MAX_ONBOARDING_OPTIONS = 25;
export const PROMPT_TITLE_MAX = 100;
export const OPTION_TITLE_MAX = 50;
export const OPTION_DESCRIPTION_MAX = 100;

export interface BuildResult {
    prompt: {
        id?: string;
        title: string;
        singleSelect: boolean;
        required: boolean;
        inOnboarding: boolean;
        type: GuildOnboardingPromptType;
        options: { id?: string; title: string; description: string | null; roles: string[]; channels: never[] }[];
    };
    /** Option bị bỏ vì vượt trần — người gọi phải nói ra, không được im lặng cắt bớt. */
    dropped: MenuOptionInput[];
}

/**
 * Role menu -> prompt onboarding.
 *
 * `id` được giữ lại khi menu này đã từng đẩy lên: Discord coi prompt thiếu id là prompt MỚI,
 * nên bỏ id đi là mỗi lần sync lại sinh thêm một bản trùng.
 */
export function buildOnboardingPrompt(menu: MenuInput, existing?: ExistingPrompt | null): BuildResult {
    const kept = menu.options.slice(0, MAX_ONBOARDING_OPTIONS);
    const dropped = menu.options.slice(MAX_ONBOARDING_OPTIONS);

    return {
        prompt: {
            ...(existing ? { id: existing.id } : {}),
            title: menu.title.slice(0, PROMPT_TITLE_MAX),
            // mode 'unique' = chỉ được chọn một role, ánh xạ thẳng sang single_select.
            singleSelect: menu.mode === 'unique',
            // Không bắt buộc: người mới bỏ qua được. Bắt buộc mà menu chỉ là sở thích thì
            // đó là một bức tường trước cửa server.
            required: false,
            inOnboarding: true,
            type: GuildOnboardingPromptType.MultipleChoice,
            options: kept.map(option => ({
                title: option.label.slice(0, OPTION_TITLE_MAX),
                description: option.description?.slice(0, OPTION_DESCRIPTION_MAX) || null,
                roles: [option.roleId],
                channels: []
            }))
        },
        dropped
    };
}

/**
 * Trộn prompt mới vào danh sách prompt đang có: THAY prompt cùng tiêu đề, giữ nguyên phần
 * còn lại.
 *
 * Đây là chốt quan trọng nhất của cả tính năng. `editOnboarding` ghi đè TOÀN BỘ danh sách
 * prompt, nên gửi mỗi prompt của mình lên là xoá sạch những prompt admin đã dựng tay trong
 * Server Settings — mất im lặng, và không có nút hoàn tác.
 */
export function mergePrompts<T extends { id: string; title: string }>(
    existingPrompts: T[],
    nextPrompt: { id?: string; title: string }
): (T | typeof nextPrompt)[] {
    const index = existingPrompts.findIndex(prompt =>
        (nextPrompt.id && prompt.id === nextPrompt.id) || prompt.title === nextPrompt.title
    );
    if (index === -1) return [...existingPrompts, nextPrompt];
    const merged: (T | typeof nextPrompt)[] = [...existingPrompts];
    merged[index] = nextPrompt;
    return merged;
}

/** Prompt đang có của menu này (khớp theo tiêu đề đã cắt), để giữ lại id lúc sync lại. */
export function findPromptByTitle<T extends { id: string; title: string }>(
    existingPrompts: T[],
    title: string
): T | null {
    const wanted = title.slice(0, PROMPT_TITLE_MAX);
    return existingPrompts.find(prompt => prompt.title === wanted) ?? null;
}

/** Bỏ prompt của một menu ra khỏi danh sách. Trả về null nếu không có gì để bỏ. */
export function removePromptByTitle<T extends { id: string; title: string }>(
    existingPrompts: T[],
    title: string
): T[] | null {
    const next = existingPrompts.filter(prompt => prompt.title !== title.slice(0, PROMPT_TITLE_MAX));
    return next.length === existingPrompts.length ? null : next;
}
