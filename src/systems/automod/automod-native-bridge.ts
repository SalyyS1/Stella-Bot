import { AutoModerationActionType, AutoModerationRuleTriggerType } from 'discord.js';

// Nối AutoMod GỐC của Discord vào hệ log/strike của Stella.
//
// Vì sao cần: hai hệ bù nhau chứ không thay nhau. AutoMod gốc chặn tin TRƯỚC khi đăng
// (spam ML, mention raid, nickname bẩn) — thứ Stella không làm được vì automod của Stella
// xoá SAU khi đăng. Nhưng nếu để riêng, mod phải đọc hai kênh log và một người bị AutoMod
// gốc chặn 5 lần vẫn hiện "0 strike" trong `/automod strikes`. Bậc leo thang 3/5/8 khi đó
// đếm sai theo hướng nguy hiểm nhất: bỏ sót người vi phạm nhiều nhất.
//
// File này chỉ dịch dữ liệu (thuần, không I/O) để test được mà không cần gateway.

/** Nhãn tiếng Việt cho loại trigger — mod đọc log phải hiểu ngay luật nào đã chặn. */
export const NATIVE_TRIGGER_LABEL: Partial<Record<AutoModerationRuleTriggerType, string>> = {
    [AutoModerationRuleTriggerType.Keyword]: 'Từ khoá (AutoMod Discord)',
    [AutoModerationRuleTriggerType.Spam]: 'Spam (AutoMod Discord)',
    [AutoModerationRuleTriggerType.KeywordPreset]: 'Từ ngữ xấu — bộ lọc sẵn (AutoMod Discord)',
    [AutoModerationRuleTriggerType.MentionSpam]: 'Ping quá nhiều (AutoMod Discord)',
    [AutoModerationRuleTriggerType.MemberProfile]: 'Tên/hồ sơ vi phạm (AutoMod Discord)'
};

/** Discord đã làm gì với tin đó. Quyết định câu chữ trong log — và có ghi strike hay không. */
export const NATIVE_ACTION_LABEL: Partial<Record<AutoModerationActionType, string>> = {
    [AutoModerationActionType.BlockMessage]: 'chặn tin trước khi đăng',
    [AutoModerationActionType.SendAlertMessage]: 'báo kênh cảnh báo',
    [AutoModerationActionType.Timeout]: 'timeout',
    [AutoModerationActionType.BlockMemberInteraction]: 'chặn tương tác'
};

export interface NativeExecution {
    action: { type: AutoModerationActionType };
    ruleTriggerType: AutoModerationRuleTriggerType;
    userId: string | null;
    channelId: string | null;
    content: string | null;
    matchedKeyword: string | null;
    ruleId: string | null;
}

export interface NativeViolation {
    userId: string;
    channelId: string | null;
    triggerLabel: string;
    actionLabel: string;
    detail: string;
    content: string;
    /** Ghi strike hay chỉ log. */
    countsAsStrike: boolean;
}

/**
 * Sự kiện AutoMod gốc -> dữ liệu để log và ghi strike. `null` = bỏ qua.
 *
 * `SendAlertMessage` KHÔNG tính strike: nó bắn kèm mọi lần chặn, nên tính cả hai là mỗi
 * lượt vi phạm thành 2 strike và bậc leo thang 3/5/8 chạm sớm gấp đôi mức Saly đã chốt.
 */
export function toNativeViolation(execution: NativeExecution): NativeViolation | null {
    if (!execution.userId) return null;

    const actionType = execution.action?.type;
    const actionLabel = NATIVE_ACTION_LABEL[actionType];
    if (!actionLabel) return null;

    const triggerLabel = NATIVE_TRIGGER_LABEL[execution.ruleTriggerType] ?? 'AutoMod Discord';
    const matched = execution.matchedKeyword?.trim();

    return {
        userId: execution.userId,
        channelId: execution.channelId,
        triggerLabel,
        actionLabel,
        detail: matched
            ? `Discord ${actionLabel} · khớp \`${matched.slice(0, 80)}\``
            : `Discord ${actionLabel}`,
        content: (execution.content || '').slice(0, 900),
        countsAsStrike: actionType !== AutoModerationActionType.SendAlertMessage
    };
}
