import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildOnboardingPrompt,
    findPromptByTitle,
    mergePrompts,
    removePromptByTitle,
    MAX_ONBOARDING_OPTIONS,
    PROMPT_TITLE_MAX
} from '../src/systems/rolemenu/onboarding-sync';

// Lý do có test này: `editOnboarding` ghi đè TOÀN BỘ danh sách prompt. Gửi lên mỗi prompt
// của mình là xoá sạch những prompt admin đã dựng tay trong Server Settings — mất im lặng,
// không có nút hoàn tác, và chỉ lộ ra khi người mới tiếp theo vào server. mergePrompts là
// chốt duy nhất chặn chuyện đó nên nó phải được kiểm bằng test, không phải bằng niềm tin.

function menu(overrides: any = {}) {
    return {
        id: 1,
        title: 'Chọn sở thích',
        mode: 'multi',
        options: [
            { roleId: 'role-1', label: 'Builder', description: 'Thích xây', emoji: null },
            { roleId: 'role-2', label: 'Coder', description: null, emoji: null }
        ],
        ...overrides
    };
}

test('menu -> prompt: moi option thanh mot lua chon gan dung mot role', () => {
    const { prompt, dropped } = buildOnboardingPrompt(menu());
    assert.equal(prompt.title, 'Chọn sở thích');
    assert.equal(prompt.inOnboarding, true);
    assert.equal(prompt.required, false, 'khong duoc bat buoc — menu so thich khong phai buc tuong truoc cua');
    assert.deepEqual(prompt.options.map(o => o.roles), [['role-1'], ['role-2']]);
    assert.equal(prompt.options[1].description, null);
    assert.deepEqual(dropped, []);
});

test('mode unique -> single_select', () => {
    assert.equal(buildOnboardingPrompt(menu({ mode: 'unique' })).prompt.singleSelect, true);
    assert.equal(buildOnboardingPrompt(menu({ mode: 'multi' })).prompt.singleSelect, false);
});

test('vuot tran thi cat va BAO LAI phan bi bo, khong im lang', () => {
    const many = Array.from({ length: MAX_ONBOARDING_OPTIONS + 3 }, (_, index) => ({
        roleId: `role-${index}`, label: `Role ${index}`, description: null, emoji: null
    }));
    const { prompt, dropped } = buildOnboardingPrompt(menu({ options: many }));
    assert.equal(prompt.options.length, MAX_ONBOARDING_OPTIONS);
    assert.equal(dropped.length, 3);
    assert.equal(dropped[0].label, `Role ${MAX_ONBOARDING_OPTIONS}`);
});

test('cat chuoi qua dai theo tran cua Discord', () => {
    const { prompt } = buildOnboardingPrompt(menu({
        title: 'x'.repeat(200),
        options: [{ roleId: 'r', label: 'y'.repeat(200), description: 'z'.repeat(400), emoji: null }]
    }));
    assert.equal(prompt.title.length, PROMPT_TITLE_MAX);
    assert.equal(prompt.options[0].title.length, 50);
    assert.equal(prompt.options[0].description!.length, 100);
});

test('sync lai giu id cu — thieu id thi Discord tao them mot prompt trung', () => {
    const existing = { id: 'prompt-9', title: 'Chọn sở thích' };
    const { prompt } = buildOnboardingPrompt(menu(), existing);
    assert.equal(prompt.id, 'prompt-9');
    assert.equal(buildOnboardingPrompt(menu()).prompt.id, undefined);
});

test('mergePrompts GIU prompt admin tu dung — day la chot chong xoa im lang', () => {
    const existing = [
        { id: 'p1', title: 'Quy định server' },
        { id: 'p2', title: 'Chọn sở thích' },
        { id: 'p3', title: 'Bạn biết tới server từ đâu?' }
    ];
    const merged = mergePrompts(existing, { id: 'p2', title: 'Chọn sở thích' });
    assert.equal(merged.length, 3, 'khong duoc lam mat prompt nao');
    assert.deepEqual(merged.map((p: any) => p.title), ['Quy định server', 'Chọn sở thích', 'Bạn biết tới server từ đâu?']);
    assert.equal(merged[1].id, 'p2', 'phai THAY dung cho cu, khong doi thu tu');
});

test('prompt moi thi them vao cuoi, van giu nguyen phan cu', () => {
    const existing = [{ id: 'p1', title: 'Quy định server' }];
    const merged = mergePrompts(existing, { title: 'Menu mới' });
    assert.equal(merged.length, 2);
    assert.equal((merged[0] as any).id, 'p1');
    assert.equal((merged[1] as any).title, 'Menu mới');
});

test('khop theo tieu de khi chua co id — tranh nhan doi sau lan sync dau', () => {
    const existing = [{ id: 'p1', title: 'Chọn sở thích' }];
    const merged = mergePrompts(existing, { title: 'Chọn sở thích' });
    assert.equal(merged.length, 1, 'cung tieu de thi phai THAY, khong them ban trung');
});

test('go: bo dung prompt cua menu, tra null khi khong co gi de bo', () => {
    const existing = [{ id: 'p1', title: 'Quy định server' }, { id: 'p2', title: 'Chọn sở thích' }];
    const next = removePromptByTitle(existing, 'Chọn sở thích');
    assert.deepEqual(next!.map(p => p.title), ['Quy định server']);
    assert.equal(removePromptByTitle(existing, 'Không có menu này'), null);
});

test('findPromptByTitle khop ca khi tieu de bi cat', () => {
    const long = 'x'.repeat(200);
    const existing = [{ id: 'p1', title: 'x'.repeat(PROMPT_TITLE_MAX) }];
    assert.equal(findPromptByTitle(existing, long)?.id, 'p1');
    assert.equal(findPromptByTitle(existing, 'khac'), null);
});
