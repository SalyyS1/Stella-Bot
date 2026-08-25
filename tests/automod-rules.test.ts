import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkContentRules, type RuleTable } from '../src/systems/automod/automod-rules';
import { resetTracker, trackMessage } from '../src/systems/automod/automod-flood-tracker';

// Ly do co test nay: automod la thu de chan oan nhat trong ca con bot. Mot lan chan
// nham tin nhan binh thuong la mot member that mat niem tin, va ho khong bao lai —
// ho chi chat it di. Cac case duoi day la nhung cho de sai nhat.

const rules = (overrides: RuleTable): RuleTable => overrides;

test('caps khong chan tin ngan kieu "OK!!!"', () => {
    const table = rules({ caps: { enabled: true, minLength: 12, percent: 75 } });
    assert.equal(checkContentRules({ content: 'OK!!!!!!!!!!!!!!', mentionCount: 0 }, table), null);
});

test('caps chan cau dai viet hoa toan bo', () => {
    const table = rules({ caps: { enabled: true, minLength: 12, percent: 75 } });
    const hit = checkContentRules({ content: 'MOI NGUOI VAO DAY NHANH LEN DI', mentionCount: 0 }, table);
    assert.equal(hit?.rule, 'caps');
});

test('tieng Viet co dau khong bi coi la zalgo', () => {
    const table = rules({ zalgo: { enabled: true } });
    const content = 'Chào mọi người, hôm nay mình vừa hoàn thành xong plugin mới rất đẹp';
    assert.equal(checkContentRules({ content, mentionCount: 0 }, table), null);
});

test('tieng Viet go o dang NFD cung khong bi coi la zalgo', () => {
    // Mot so IME/macOS tra ve chuoi NFD: "ế" = e + hai dau phu roi. Neu dem dau phu
    // trên chuoi tho thi ca cau tieng Viet se dinh luat zalgo.
    const table = rules({ zalgo: { enabled: true } });
    const content = 'Chào mọi người, hôm nay mình rất vui vì đã hoàn thành'.normalize('NFD');
    assert.equal(checkContentRules({ content, mentionCount: 0 }, table), null);
});

test('zalgo that su bi chan', () => {
    const table = rules({ zalgo: { enabled: true } });
    const zalgo = 'h̸̡̢̛̬̮̭̘̙̆̈́̊̇e̷̢̛̬̮̭̘̊̇̈́l̸̡̛̬̮̭̘̆̊̇l̷̢̬̮̭̘̆̈́̊ơ̸̡̬̮̭̊̇̈́';
    assert.equal(checkContentRules({ content: zalgo, mentionCount: 0 }, table)?.rule, 'zalgo');
});

test('bannedWords khop theo tu, khong khop giua tu', () => {
    const table = rules({ bannedWords: { enabled: true, words: ['bede'] } });
    assert.equal(checkContentRules({ content: 'cai ban bedeck nay dep', mentionCount: 0 }, table), null);
    assert.equal(checkContentRules({ content: 'thang bede kia', mentionCount: 0 }, table)?.rule, 'bannedWords');
});

test('scamLink chan ten mien mao danh nhung tha link that', () => {
    const table = rules({ scamLink: { enabled: true } });
    assert.equal(checkContentRules({ content: 'vao https://dlscord-nitro.ru/free di', mentionCount: 0 }, table)?.rule, 'scamLink');
    // Cong dong dev dan link nay hang ngay — chan no la chan dung nguoi dang giup nhau.
    assert.equal(checkContentRules({ content: 'doc https://discord.js.org/docs nhe', mentionCount: 0 }, table), null);
    assert.equal(checkContentRules({ content: 'https://discord.com/channels/1/2/3', mentionCount: 0 }, table), null);
});

test('inviteLink chan link moi server khac', () => {
    const table = rules({ inviteLink: { enabled: true } });
    assert.equal(checkContentRules({ content: 'join discord.gg/abcdef nhe', mentionCount: 0 }, table)?.rule, 'inviteLink');
});

test('massMention dem theo so nguoi thuc te bi ping', () => {
    const table = rules({ massMention: { enabled: true, limit: 6 } });
    assert.equal(checkContentRules({ content: 'hi', mentionCount: 6 }, table), null);
    assert.equal(checkContentRules({ content: 'hi', mentionCount: 7 }, table)?.rule, 'massMention');
});

test('flood chi bat khi du so tin trong cua so, va reset sau khi bat', () => {
    resetTracker('u1');
    const flood = { enabled: true, messages: 3, windowMs: 5_000 };
    assert.equal(trackMessage('u1', 'a', 1_000, flood, undefined), null);
    assert.equal(trackMessage('u1', 'b', 1_100, flood, undefined), null);
    assert.equal(trackMessage('u1', 'c', 1_200, flood, undefined)?.rule, 'flood');
    // Reset sau khi bat: neu khong thi moi tin tiep theo trong cung dot spam lai la mot
    // vi pham moi, va nguoi dung an 10 strike cho mot lan go nhanh.
    assert.equal(trackMessage('u1', 'd', 1_300, flood, undefined), null);
});

test('flood khong bat khi cac tin nam ngoai cua so thoi gian', () => {
    resetTracker('u2');
    const flood = { enabled: true, messages: 3, windowMs: 5_000 };
    assert.equal(trackMessage('u2', 'a', 0, flood, undefined), null);
    assert.equal(trackMessage('u2', 'b', 6_000, flood, undefined), null);
    assert.equal(trackMessage('u2', 'c', 12_000, flood, undefined), null);
});

test('duplicate bat khi lap lai cung noi dung, bo qua tin rong', () => {
    resetTracker('u3');
    const dup = { enabled: true, times: 3, windowMs: 30_000 };
    assert.equal(trackMessage('u3', 'mua di', 0, undefined, dup), null);
    assert.equal(trackMessage('u3', 'MUA DI  ', 1_000, undefined, dup), null);
    assert.equal(trackMessage('u3', 'mua di', 2_000, undefined, dup)?.rule, 'duplicate');

    resetTracker('u4');
    // Gui 3 anh lien nhau (content rong) la hanh vi binh thuong o kenh share.
    assert.equal(trackMessage('u4', '', 0, undefined, dup), null);
    assert.equal(trackMessage('u4', '', 1_000, undefined, dup), null);
    assert.equal(trackMessage('u4', '', 2_000, undefined, dup), null);
});
