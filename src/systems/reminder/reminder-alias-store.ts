import prisma from '../../lib/prisma';

// Tên gợi nhớ: "ri" -> user id. Cho phép nói "nhắc Ri đi tắm" thay vì phải mở
// danh sách member ping đúng người — đúng cái việc mà tính năng nhắc nhở định
// tiết kiệm.
//
// Ai được THÊM tên là chốt quyền, và nó nằm ở tầng lệnh (commands/remind.ts),
// không ở đây: store chỉ ghi và đọc. Lý do phải siết là một tên trỏ sai người sẽ
// ping oan người đó mỗi ngày, và người bị ping không có cách nào biết vì sao.

// alias luôn được lowercase trước khi ghi/đọc. Không normalize thì "Ri" và "ri"
// thành hai dòng khác nhau, và người dùng viết hoa khác lúc đặt sẽ tra không ra.
function norm(alias: string): string {
    return alias.trim().toLowerCase();
}

export async function setAlias(alias: string, userId: string, addedBy: string): Promise<boolean> {
    const key = norm(alias);
    if (!key) return false;
    // upsert: đặt lại cùng một tên cho người khác là việc hợp lý (đổi nickname,
    // sửa tên đặt sai) — bắt người dùng xoá rồi thêm lại chỉ thêm một bước mà
    // không thêm an toàn nào.
    const ok = await prisma.reminderAlias.upsert({
        where: { alias: key },
        create: { alias: key, userId, addedBy },
        update: { userId, addedBy }
    }).then(() => true).catch(error => {
        console.error(`[reminder] setAlias ${key} failed:`, error);
        return false;
    });
    return ok;
}

export async function resolveAlias(alias: string): Promise<string | null> {
    const key = norm(alias);
    if (!key) return null;
    const row = await prisma.reminderAlias
        .findUnique({ where: { alias: key }, select: { userId: true } })
        .catch(error => {
            console.error(`[reminder] resolveAlias ${key} failed:`, error);
            return null;
        });
    return row?.userId ?? null;
}

export async function removeAlias(alias: string): Promise<boolean> {
    const key = norm(alias);
    if (!key) return false;
    const result = await prisma.reminderAlias
        .deleteMany({ where: { alias: key } })
        .catch(error => {
            console.error(`[reminder] removeAlias ${key} failed:`, error);
            return { count: 0 };
        });
    return result.count > 0;
}

export async function listAliases() {
    return prisma.reminderAlias.findMany({
        orderBy: { alias: 'asc' },
        take: 50,
        select: { alias: true, userId: true }
    }).catch(error => {
        console.error('[reminder] listAliases failed:', error);
        return [] as Array<{ alias: string; userId: string }>;
    });
}
