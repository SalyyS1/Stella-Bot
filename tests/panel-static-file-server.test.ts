import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { lookupAsset, resolveAsset, staticRoot } from '../src/panel/static-file-server';

// Ly do co test nay: day la cho nguy hiem nhat cua ca panel. Ghep duong dan tu URL vao
// thu muc goc ma khong kiem lai ket qua la de `GET /../../.env` doc duoc dung file chua
// BOT_TOKEN va DATABASE_URL. Loi nay khong bao gio hien ra khi dung binh thuong — chi
// hien khi co nguoi thu, va luc do thi da muon.

test('duong dan binh thuong ra file trong web/out', async () => {
    const asset = await resolveAsset('/index.html');
    assert.ok(asset, 'index.html phai giai duoc');
    assert.equal(asset!.contentType, 'text/html; charset=utf-8');
    assert.ok(asset!.absolutePath.startsWith(staticRoot()));
});

test('duong dan goc / ra index.html', async () => {
    const asset = await resolveAsset('/');
    assert.ok(asset);
    assert.equal(path.basename(asset!.absolutePath), 'index.html');
});

test('index.html KHONG duoc cache, file co hash thi cache dai', async () => {
    const asset = await resolveAsset('/index.html');
    assert.equal(asset!.immutable, false);
});

test('traversal bang ".." bi chan', async () => {
    assert.equal(await resolveAsset('/../.env'), null);
    assert.equal(await resolveAsset('/../../.env'), null);
    assert.equal(await resolveAsset('/../package.json'), null);
    assert.equal(await resolveAsset('/subdir/../../.env'), null);
});

test('traversal bang URL-encoding cung bi chan', async () => {
    // Ly do khong loc chuoi ".." ma phai resolve roi kiem: ".." con ma hoa duoc.
    assert.equal(await resolveAsset('/%2e%2e/%2e%2e/.env'), null);
    assert.equal(await resolveAsset('/%2e%2e%2f%2e%2e%2f.env'), null);
});

test('duong dan tuyet doi khong thoat ra khoi web/out', async () => {
    // path.resolve(root, '/etc/passwd') tra ve '/etc/passwd' — phai bo dau '/' truoc.
    assert.equal(await resolveAsset('/etc/passwd'), null);
    assert.equal(await resolveAsset('///etc/passwd'), null);
});

test('URL ma hoa sai va byte null ra null chu khong nem loi', async () => {
    assert.equal(await resolveAsset('/%zz'), null);
    assert.equal(await resolveAsset('/index.html%00.png'), null);
});

test('duoi file khong nam trong danh sach cho phep thi 404', async () => {
    // Danh sach CHO PHEP, khong phai danh sach chan: file la copy vao web/out cung
    // khong ra duoc.
    assert.equal(await resolveAsset('/index.ts'), null);
    assert.equal(await resolveAsset('/.env'), null);
    assert.equal(await resolveAsset('/data.db'), null);
});

test('file khong ton tai ra null', async () => {
    assert.equal(await resolveAsset('/khong-co-file-nay.html'), null);
});

test('phan biet "khong co file" voi "duong dan bi tu choi"', async () => {
    // Router can hai ket qua khac nhau: thieu file thi fallback SPA duoc, bi tu choi
    // thi phai 404 cung. Tra chung mot ket qua la mot lan thu traversal nhan ve 200.
    assert.equal((await lookupAsset('/khong-co-trang-nay')).kind, 'missing');
    assert.equal((await lookupAsset('/../../.env')).kind, 'rejected');
    assert.equal((await lookupAsset('/%2e%2e%2f.env')).kind, 'rejected');
    assert.equal((await lookupAsset('/index.ts')).kind, 'rejected');
    assert.equal((await lookupAsset('/index.html')).kind, 'file');
});
