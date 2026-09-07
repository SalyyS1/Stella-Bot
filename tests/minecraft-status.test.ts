import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMinecraftText, parseMinecraftAddress } from '../src/systems/minecraft/minecraft-status';

// Lý do có test này: `/mc status` nhận địa chỉ do người dùng gõ. Một hàm parse lỏng là một
// lệnh tra cứu gọi API với địa chỉ lạ; một hàm parse chặt quá thì từ chối địa chỉ đúng và
// người hỗ trợ khách phải đoán tại sao. fetchMinecraftStatus không test ở đây — nó cần mạng.

test('parse: host tran, host:port, tien to minecraft://', () => {
    assert.deepEqual(parseMinecraftAddress('mc.hypixel.net'), { host: 'mc.hypixel.net', port: 25565 });
    assert.deepEqual(parseMinecraftAddress('mc.example.com:25566'), { host: 'mc.example.com', port: 25566 });
    assert.deepEqual(parseMinecraftAddress('minecraft://mc.example.com'), { host: 'mc.example.com', port: 25565 });
    assert.deepEqual(parseMinecraftAddress('  mc.example.com:25567  '), { host: 'mc.example.com', port: 25567 });
});

test('tu choi: rong, khoang trang, port sai, nhieu hon mot dau ":"', () => {
    const bad = [
        '', '   ', 'mc example.com',
        'mc.example.com:abc', 'mc.example.com:0', 'mc.example.com:70000',
        'mc.example.com:25.5', // port thap phan: Number() nhan nhung khong phai port
        'mc.example.com:25565:1', // go nham
        '::1', '2001:db8::1' // IPv6 tran: mcstatus.io khong nhan, doan bua la tra sai host
    ];
    for (const input of bad) {
        assert.equal(parseMinecraftAddress(input), null, `phai tu choi: "${input}"`);
    }
});

test('cleanMinecraftText: bo ma mau § va gon khoang trang', () => {
    assert.equal(cleanMinecraftText('§aHypixel §7Network'), 'Hypixel Network');
    assert.equal(cleanMinecraftText('§l§6Bold   Gold'), 'Bold Gold');
    assert.equal(cleanMinecraftText(undefined), '');
    assert.equal(cleanMinecraftText('   '), '');
});
