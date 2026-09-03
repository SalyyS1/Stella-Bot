import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Guild } from 'discord.js';
import { buildStickerHint, extractSticker } from '../src/systems/emoji-palette';

// Ly do co test nay: Saly bao bot "hay dinh kem bua bai sticker cha lien quan gi". Hai
// chot sua loi do nam o day: (1) prompt phai mo ta sticker TRONG NHU THE NAO chu khong chi
// ten, (2) code tu chan sticker o cau tra loi ky thuat bat ke model muon gi. Chot (2) la
// luat, khong phai loi khuyen — nen no phai co test.

interface FakeSticker {
    id: string;
    name: string;
    description: string | null;
    tags: string | null;
    available: boolean | null;
}

function fakeGuild(stickers: FakeSticker[]): Guild {
    const cache = {
        filter: (fn: (s: FakeSticker) => boolean) => {
            const kept = stickers.filter(fn);
            return { first: (n: number) => kept.slice(0, n) };
        },
        find: (fn: (s: FakeSticker) => boolean) => stickers.find(fn)
    };
    return { id: 'guild-1', stickers: { cache } } as unknown as Guild;
}

const CAT_CRY: FakeSticker = { id: '111', name: 'catcry', description: 'mèo khóc nức nở', tags: '😭', available: true };
const GG: FakeSticker = { id: '222', name: 'gg', description: null, tags: '🎉', available: true };
const LOCKED: FakeSticker = { id: '333', name: 'locked', description: 'bị khoá', tags: '🔒', available: false };

test('prompt mo ta sticker bang description va tags, khong chi ten', () => {
    const hint = buildStickerHint(fakeGuild([CAT_CRY, GG]));
    assert.match(hint, /catcry \(mèo khóc nức nở · 😭\)/);
    assert.match(hint, /gg \(🎉\)/, 'thieu description thi van phai co emoji dai dien');
    assert.match(hint, /MẶC ĐỊNH KHÔNG THẢ/, 'quy tac mac dinh phai la khong tha');
    assert.match(hint, /kỹ thuật/, 'phai noi ro khong tha o cau ky thuat');
});

test('sticker bi khoa (available=false) khong vao prompt', () => {
    const hint = buildStickerHint(fakeGuild([LOCKED, GG]));
    assert.doesNotMatch(hint, /locked/);
    assert.match(hint, /gg/);
});

test('cau tan gau ngan + ten dung -> co sticker, marker bi xoa', () => {
    const out = extractSticker('hihi thua roi [[sticker:catcry]]', fakeGuild([CAT_CRY, GG]));
    assert.equal(out.text, 'hihi thua roi');
    assert.equal(out.stickerId, '111');
});

test('ten sticker khong ton tai -> marker van bi xoa, khong co sticker', () => {
    const out = extractSticker('hihi [[sticker:khongco]]', fakeGuild([CAT_CRY]));
    assert.equal(out.text, 'hihi');
    assert.equal(out.stickerId, undefined);
});

test('cau tra loi co code block -> KHONG tha sticker du model doi', () => {
    const text = 'Sua config nhu sau:\n```yaml\nenabled: true\n```\n[[sticker:catcry]]';
    const out = extractSticker(text, fakeGuild([CAT_CRY]));
    assert.equal(out.stickerId, undefined, 'code block la dau hieu cau ky thuat');
    assert.doesNotMatch(out.text, /\[\[sticker/);
});

test('cau tra loi dai (huong dan nhieu buoc) -> KHONG tha sticker', () => {
    const long = 'Bước 1: ' + 'x'.repeat(800) + ' [[sticker:catcry]]';
    const out = extractSticker(long, fakeGuild([CAT_CRY]));
    assert.equal(out.stickerId, undefined);
});

test('sticker bi khoa luc gui (sau khi prompt duoc cache) -> khong gui', () => {
    // Prompt cache 10 phut; server co the tut boost trong khoang do. extractSticker
    // phai tra lai `available` ngay luc gui chu khong tin danh sach cu.
    const out = extractSticker('vui qua [[sticker:locked]]', fakeGuild([LOCKED]));
    assert.equal(out.stickerId, undefined);
    assert.equal(out.text, 'vui qua');
});

test('khong co guild (DM) -> marker bi xoa, khong sticker', () => {
    const out = extractSticker('hi [[sticker:catcry]]', null);
    assert.equal(out.text, 'hi');
    assert.equal(out.stickerId, undefined);
});
