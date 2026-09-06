import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLogEvent } from 'discord.js';
import {
    memberChangeKindsOf,
    rememberMemberUpdateEntry,
    resolveMemberActor,
    resolveMemberActorsWithGrace
} from '../src/systems/logs/audit-actor-resolver';

// Lý do có test này: log "ai cấp role cho ai" mà gán NHẦM người còn tệ hơn không ghi —
// mod đọc log rồi tin. Ca thật lúc onboard: mod A đổi nick, mod B cấp role cho cùng một
// người trong cùng giây. Hai entry audit log, hai action khác nhau, phải ra hai người.

function entry(action: AuditLogEvent, targetId: string, executorId: string, changes: { key: string }[] = []) {
    return { action, targetId, executorId, changes } as any;
}

test('phan loai entry: role rieng, nick va timeout cung nam trong MemberUpdate', () => {
    assert.deepEqual(memberChangeKindsOf(entry(AuditLogEvent.MemberRoleUpdate, 'u', 'm')), ['roles']);
    assert.deepEqual(
        memberChangeKindsOf(entry(AuditLogEvent.MemberUpdate, 'u', 'm', [{ key: 'nick' }])),
        ['nick']
    );
    assert.deepEqual(
        memberChangeKindsOf(entry(AuditLogEvent.MemberUpdate, 'u', 'm', [{ key: 'communication_disabled_until' }])),
        ['timeout']
    );
    // MemberUpdate ma khong doi nick/timeout (vd. deaf/mute voice) thi khong phai viec cua log nay.
    assert.deepEqual(memberChangeKindsOf(entry(AuditLogEvent.MemberUpdate, 'u', 'm', [{ key: 'deaf' }])), []);
    assert.deepEqual(memberChangeKindsOf(entry(AuditLogEvent.MessageDelete, 'u', 'm')), []);
});

test('hai mod dong thoi tren cung mot nguoi: moi loai thay doi ra dung nguoi cua no', () => {
    rememberMemberUpdateEntry(entry(AuditLogEvent.MemberUpdate, 'member-1', 'mod-nick', [{ key: 'nick' }]));
    rememberMemberUpdateEntry(entry(AuditLogEvent.MemberRoleUpdate, 'member-1', 'mod-role'));

    assert.equal(resolveMemberActor('member-1', 'nick'), 'mod-nick');
    assert.equal(resolveMemberActor('member-1', 'roles'), 'mod-role');
    assert.equal(resolveMemberActor('member-1', 'timeout'), null);
    // Nguoi khac khong dinh dang.
    assert.equal(resolveMemberActor('member-2', 'roles'), null);
});

test('entry thieu target hoac executor thi bo qua, khong ghi ban ghi rong', () => {
    rememberMemberUpdateEntry({ action: AuditLogEvent.MemberRoleUpdate, targetId: null, executorId: 'x', changes: [] } as any);
    rememberMemberUpdateEntry({ action: AuditLogEvent.MemberRoleUpdate, targetId: 'member-3', executorId: null, changes: [] } as any);
    assert.equal(resolveMemberActor('member-3', 'roles'), null);
});

test('resolveMemberActorsWithGrace: co du ngay thi khong cho; thieu thi cho mot nhip roi tra lai', async () => {
    rememberMemberUpdateEntry(entry(AuditLogEvent.MemberRoleUpdate, 'member-4', 'mod-a'));
    const started = Date.now();
    const immediate = await resolveMemberActorsWithGrace('member-4', ['roles'], 500);
    assert.equal(immediate.get('roles'), 'mod-a');
    assert.ok(Date.now() - started < 200, 'khong duoc cho khi da co du');

    // Audit log toi SAU event: ghi vao giua luc dang cho.
    setTimeout(() => rememberMemberUpdateEntry(entry(AuditLogEvent.MemberUpdate, 'member-5', 'mod-b', [{ key: 'nick' }])), 50);
    const late = await resolveMemberActorsWithGrace('member-5', ['nick', 'roles'], 150);
    assert.equal(late.get('nick'), 'mod-b');
    assert.equal(late.get('roles'), null);
});
