import { AutoModerationActionExecution, Events } from 'discord.js';
import { config } from '../config';
import { logViolation, alertModerators } from '../systems/automod/automod-alert';
import { recordStrike } from '../systems/automod/automod-strikes';
import { toNativeViolation } from '../systems/automod/automod-native-bridge';

// AutoMod GỐC của Discord vừa chặn một tin → ghi vào đúng kênh log và bộ đếm strike của
// Stella. Không có chỗ này thì mod phải đọc hai kênh log, và người bị Discord chặn liên
// tục vẫn hiện "0 strike" nên không bao giờ chạm bậc leo thang.
//
// Bot KHÔNG tự phạt ở đây (Saly chốt 2026-08-25) — chạm mốc thì hiện embed kèm nút cho mod
// quyết, giống hệt đường automod của Stella.
export default {
    name: Events.AutoModerationActionExecution,
    once: false,
    async execute(execution: AutoModerationActionExecution) {
        if (!config.logs.enabled) return;

        const violation = toNativeViolation({
            action: execution.action,
            ruleTriggerType: execution.ruleTriggerType,
            userId: execution.userId,
            channelId: execution.channelId,
            content: execution.content,
            matchedKeyword: execution.matchedKeyword,
            ruleId: execution.ruleId
        });
        if (!violation) return;

        // Chỉ log, không tính strike (xem toNativeViolation): tránh đếm đôi một lượt vi phạm.
        if (!violation.countsAsStrike) return;

        const { count, tier } = await recordStrike(violation.userId, 'native', violation.channelId);

        const member = await execution.guild.members.fetch(violation.userId).catch(() => null);
        const logInput = {
            client: execution.guild.client,
            userId: violation.userId,
            userTag: member?.user.tag ?? violation.userId,
            // Vi phạm hồ sơ/tên không gắn với kênh nào; log vẫn cần một kênh để hiển thị.
            channelId: violation.channelId ?? config.channels.chat,
            rule: 'native' as const,
            detail: `${violation.triggerLabel} · ${violation.detail}`,
            content: violation.content,
            strikeCount: count
        };

        await logViolation(logInput).catch(error => console.error('[automod-native] log lỗi:', error));
        if (tier) {
            await alertModerators(logInput, tier).catch(error =>
                console.error('[automod-native] cảnh báo mod lỗi:', error)
            );
        }
    }
};
