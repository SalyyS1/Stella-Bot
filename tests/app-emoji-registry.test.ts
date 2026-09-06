import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config';
import {
    cdnUrlFor, isValidEmojiName, parseEmojiMarkup, planMissingEmojis
} from '../src/systems/app-emoji-registry';

// Lý do có test này: 23 emoji trong config thuộc MỘT server. Server đó xoá emoji là 271 chỗ
// hiện ra khoảng trắng và KHÔNG có lỗi nào báo — đúng loại lỗi im lặng khó truy nhất. Bước
// chuyển sang emoji của app chỉ chạy được KHI EMOJI GỐC CÒN SỐNG (ảnh tải lại từ CDN), nên
// phần tính "cần tạo những cái nào" phải đúng ngay lần chạy đầu, không có lần thứ hai.

test('doc duoc markup emoji dong va tinh', () => {
    assert.deepEqual(parseEmojiMarkup('<a:success:1490702727209287751>'), {
        animated: true, name: 'success', id: '1490702727209287751'
    });
    assert.deepEqual(parseEmojiMarkup('<:cun_error:1490702729738190869>'), {
        animated: false, name: 'cun_error', id: '1490702729738190869'
    });
});

test('tu choi thu khong phai markup custom', () => {
    for (const bad of ['', '🎉', 'success', '<a:success:>', '<a::123456789012345>', '<a:ok:12>']) {
        assert.equal(parseEmojiMarkup(bad), null, `phai tu choi: ${bad}`);
    }
});

test('URL CDN dung duoi .gif cho emoji dong va .png cho tinh', () => {
    assert.equal(
        cdnUrlFor({ animated: true, name: 'x', id: '123456789012345678' }),
        'https://cdn.discordapp.com/emojis/123456789012345678.gif'
    );
    assert.equal(
        cdnUrlFor({ animated: false, name: 'x', id: '123456789012345678' }),
        'https://cdn.discordapp.com/emojis/123456789012345678.png'
    );
});

test('ten emoji app: 2-32 ky tu, chi chu so va gach duoi', () => {
    assert.ok(isValidEmojiName('success'));
    assert.ok(isValidEmojiName('f_'));
    assert.ok(isValidEmojiName('8819shinystar3'));
    assert.ok(!isValidEmojiName('a'), 'mot ky tu la khong hop le');
    assert.ok(!isValidEmojiName('a'.repeat(33)), '33 ky tu la qua dai');
    assert.ok(!isValidEmojiName('red-arrow'), 'gach ngang khong hop le');
    assert.ok(!isValidEmojiName('red.arrow'), 'dau cham khong hop le');
});

test('moi emoji trong config phai doc duoc — day la chot that su', () => {
    // Thêm một emoji unicode hay gõ sai markup vào config thì nó sẽ KHÔNG được chuyển sang
    // emoji app, và không ai biết cho tới ngày server gốc xoá emoji.
    const bad = Object.entries(config.ui.emojis)
        .filter(([, markup]) => parseEmojiMarkup(String(markup)) === null)
        .map(([key]) => key);
    assert.deepEqual(bad, [], `config.ui.emojis co gia tri khong doc duoc: ${bad.join(', ')}`);
});

test('app chua co gi thi len ke hoach tao het, moi khoa mot cai', () => {
    const { plan, unparsable, invalidName } = planMissingEmojis([]);
    const keys = Object.keys(config.ui.emojis);
    assert.equal(unparsable.length, 0);
    assert.equal(invalidName.length, 0);
    assert.equal(plan.length, keys.length);
    assert.deepEqual(plan.map(item => item.key).sort(), [...keys].sort());
});

test('hai khoa dung chung mot ID van la hai emoji app rieng', () => {
    // `bump` và `greenArrow` trỏ cùng một ảnh. Đánh dấu theo ID thay vì theo khoá sẽ bỏ sót
    // một trong hai, và chỗ đọc khoá đó lại rơi về emoji server.
    const { plan } = planMissingEmojis([]);
    const byId = new Map<string, string[]>();
    for (const item of plan) {
        byId.set(item.source.id, [...(byId.get(item.source.id) ?? []), item.key]);
    }
    const shared = [...byId.values()].filter(keys => keys.length > 1);
    assert.ok(shared.length > 0, 'config phai con it nhat mot ID dung chung de test nay co nghia');
    for (const keys of shared) {
        for (const key of keys) {
            assert.ok(plan.some(item => item.key === key), `thieu ${key} trong ke hoach`);
        }
    }
});

test('chay lai khi da co du thi khong tao gi — lenh nay phai an toan khi bam hai lan', () => {
    const { plan } = planMissingEmojis(Object.keys(config.ui.emojis));
    assert.deepEqual(plan, []);
});

test('bo qua dung nhung khoa app da co, giu lai phan con lai', () => {
    const { plan } = planMissingEmojis(['success', 'error']);
    const keys = plan.map(item => item.key);
    assert.ok(!keys.includes('success'));
    assert.ok(!keys.includes('error'));
    assert.equal(plan.length, Object.keys(config.ui.emojis).length - 2);
});

test('ten emoji app la khoa config, khong phai ten emoji goc', () => {
    // Khoá là thứ 271 call site dùng để tra (`config.ui.emojis.bump`), nên khoá là thứ phải
    // khớp. Tên gốc (`68523animatedarrowgreen`) không xuất hiện ở chỗ nào trong code.
    const { plan } = planMissingEmojis([]);
    const bump = plan.find(item => item.key === 'bump');
    assert.ok(bump, 'thieu khoa bump');
    assert.notEqual(bump.source.name, 'bump', 'test nay chi co nghia khi ten goc khac khoa');
});
