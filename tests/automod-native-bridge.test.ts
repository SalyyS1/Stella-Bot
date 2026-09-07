import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutoModerationActionType, AutoModerationRuleTriggerType } from 'discord.js';
import { toNativeViolation } from '../src/systems/automod/automod-native-bridge';

// Lý do có test này: AutoMod gốc bắn NHIỀU event cho MỘT lượt vi phạm (chặn tin + báo kênh
// cảnh báo). Tính strike cả hai là bậc leo thang 3/5/8 chạm sớm gấp đôi mức Saly đã chốt —
// mod bị gọi dậy vì một người mới vi phạm 2 lần. Sai lặng lẽ, chỉ lộ khi đã phiền người thật.

function execution(overrides: Partial<Parameters<typeof toNativeViolation>[0]> = {}) {
    return {
        action: { type: AutoModerationActionType.BlockMessage },
        ruleTriggerType: AutoModerationRuleTriggerType.Keyword,
        userId: 'user-1',
        channelId: 'chan-1',
        content: 'noi dung tin',
        matchedKeyword: null,
        ruleId: 'rule-1',
        ...overrides
    };
}

test('chan tin: tinh strike, co nhan tieng Viet cua trigger', () => {
    const violation = toNativeViolation(execution());
    assert.ok(violation);
    assert.equal(violation.userId, 'user-1');
    assert.equal(violation.countsAsStrike, true);
    assert.match(violation.triggerLabel, /Từ khoá/);
    assert.match(violation.detail, /chặn tin trước khi đăng/);
});

test('bao kenh canh bao: CHI log, khong tinh strike — tranh dem doi mot luot vi pham', () => {
    const violation = toNativeViolation(execution({ action: { type: AutoModerationActionType.SendAlertMessage } }));
    assert.ok(violation);
    assert.equal(violation.countsAsStrike, false);
});

test('timeout cua Discord van tinh strike', () => {
    const violation = toNativeViolation(execution({ action: { type: AutoModerationActionType.Timeout } }));
    assert.equal(violation?.countsAsStrike, true);
});

test('tu khoa khop duoc dua vao detail, cat ngan', () => {
    const violation = toNativeViolation(execution({ matchedKeyword: '  tuxau  ' }));
    assert.match(violation!.detail, /khớp `tuxau`/);
    const long = toNativeViolation(execution({ matchedKeyword: 'x'.repeat(200) }));
    assert.ok(long!.detail.length < 140, 'detail phai duoc cat ngan');
});

test('thieu userId hoac action la thi bo qua, khong nem', () => {
    assert.equal(toNativeViolation(execution({ userId: null })), null);
    assert.equal(toNativeViolation(execution({ action: { type: 999 as AutoModerationActionType } })), null);
});

test('trigger la thi van log duoc voi nhan chung', () => {
    const violation = toNativeViolation(execution({ ruleTriggerType: 99 as AutoModerationRuleTriggerType }));
    assert.equal(violation?.triggerLabel, 'AutoMod Discord');
});

test('moi loai trigger cua Discord deu co nhan tieng Viet', () => {
    const triggers = [
        AutoModerationRuleTriggerType.Keyword,
        AutoModerationRuleTriggerType.Spam,
        AutoModerationRuleTriggerType.KeywordPreset,
        AutoModerationRuleTriggerType.MentionSpam,
        AutoModerationRuleTriggerType.MemberProfile
    ];
    for (const trigger of triggers) {
        const violation = toNativeViolation(execution({ ruleTriggerType: trigger }));
        assert.notEqual(violation?.triggerLabel, 'AutoMod Discord', `thieu nhan cho trigger ${trigger}`);
    }
});

test('vi pham ho so khong gan kenh: channelId null van ra violation', () => {
    const violation = toNativeViolation(execution({
        ruleTriggerType: AutoModerationRuleTriggerType.MemberProfile,
        channelId: null,
        content: null
    }));
    assert.ok(violation);
    assert.equal(violation.channelId, null);
    assert.equal(violation.content, '');
});
