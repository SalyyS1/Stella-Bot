import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import prisma from '../../lib/prisma';
import { formatBudget, parseBudgetInput } from './budget-parser';

// Sửa đơn đã đăng.
//
// Trước đây đăng xong là chốt: sai giá, thiếu yêu cầu hay đổi hạn đều phải đóng đơn rồi
// đăng lại — mất luôn lượt nhận và mọi bình luận dưới bài. Cùng loại lỗ hổng với bài
// portfolio không sửa được.
//
// Chỉ cho sửa DỊCH VỤ, CHI TIẾT và NGÂN SÁCH. Không cho đổi `kind` (PAID <-> FREE) hay
// `skill`: hai thứ đó quyết định đơn nằm ở kênh nào và ping nhóm nào — đổi giữa chừng thì
// đơn đứng sai kênh và những người đã được ping không còn liên quan. Cần đổi thì đóng đơn
// và đăng lại, đúng như trước.

export const REQUEST_EDIT_PREFIX = 'request_edit_';

export interface EditableRequest {
    id: number;
    kind: string;
    service: string;
    description: string;
    budget: string | null;
    budgetAmount: number | null;
    budgetCurrency: string | null;
}

/** `request_edit_<id>` -> id. null nếu không phải nút/modal sửa đơn. */
export function parseRequestEditId(customId: string): number | null {
    if (!customId.startsWith(REQUEST_EDIT_PREFIX)) return null;
    const raw = customId.slice(REQUEST_EDIT_PREFIX.length);
    if (!/^\d{1,9}$/.test(raw)) return null;
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Modal sửa, điền sẵn nội dung hiện tại. Ô ngân sách chỉ có với đơn PAID — đơn FREE không
 * có giá, thêm một ô trống vào đó chỉ làm người ta phân vân.
 */
export function buildRequestEditModal(request: EditableRequest): ModalBuilder {
    const modal = new ModalBuilder()
        .setCustomId(`${REQUEST_EDIT_PREFIX}${request.id}`)
        .setTitle(`Sửa đơn #${request.id}`);

    const service = new TextInputBuilder()
        .setCustomId('service')
        .setLabel('Dịch vụ cần')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(200)
        .setRequired(true)
        .setValue(request.service.slice(0, 200));

    const description = new TextInputBuilder()
        .setCustomId('request_desc')
        .setLabel('Chi tiết yêu cầu')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(2000)
        .setRequired(true)
        .setValue(request.description.slice(0, 2000));

    const rows = [
        new ActionRowBuilder<TextInputBuilder>().addComponents(service),
        new ActionRowBuilder<TextInputBuilder>().addComponents(description)
    ];

    if (request.kind === 'PAID') {
        // Điền lại đúng con số đã chuẩn hoá nếu có: hiện "1.500.000 VND" rồi bắt người ta
        // gõ lại y hệt thì lần parse sau dễ ra số khác.
        const current = request.budgetAmount && request.budgetCurrency
            ? `${request.budgetAmount} ${request.budgetCurrency}`
            : (request.budget ?? '');
        const budget = new TextInputBuilder()
            .setCustomId('budget')
            .setLabel('Ngân sách')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(200)
            .setRequired(true);
        if (current) budget.setValue(current.slice(0, 200));
        rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(budget));
    }

    return modal.addComponents(rows);
}

export interface ApplyEditInput {
    id: number;
    actorId: string;
    isAdmin: boolean;
    service: string;
    description: string;
    budgetRaw: string | null;
}

export interface ApplyEditResult {
    /** Câu báo lại cho người sửa; đã gồm cảnh báo nếu giá không parse được. */
    message: string;
}

/**
 * Ghi nội dung sửa. Ném lỗi có câu tiếng Việt đọc được nếu không được phép hoặc sai trạng thái.
 *
 * Đơn đã DONE/RATED/CLOSED thì không sửa: nội dung lúc đó là bằng chứng của việc đã xong,
 * sửa sau là viết lại lịch sử của một giao dịch giữa hai người.
 */
export async function applyRequestEdit(input: ApplyEditInput): Promise<ApplyEditResult> {
    const request = await prisma.requestPost.findUnique({ where: { id: input.id } });
    if (!request) throw new Error('Không tìm thấy đơn.');
    if (!input.isAdmin && request.requesterId !== input.actorId) {
        throw new Error('Chỉ chủ đơn hoặc ban quản trị mới sửa được.');
    }
    if (!['OPEN', 'CLAIMED'].includes(request.status)) {
        throw new Error('Đơn đã xong hoặc đã đóng thì không sửa được nữa.');
    }

    const service = input.service.trim().slice(0, 500) || request.service;
    const description = input.description.trim().slice(0, 2000) || request.description;

    // Xoá mốc đã nhắc: sửa đơn là dấu hiệu rõ nhất rằng chủ đơn còn quan tâm. Không xoá thì
    // đơn vừa được sửa lại giá vẫn bị scheduler đóng ở lượt quét kế tiếp, đúng lúc nó vừa
    // có cơ hội tìm được người nhận.
    const data: Record<string, unknown> = { service, description, staleRemindedAt: null };
    let budgetNote = '';

    if (request.kind === 'PAID' && input.budgetRaw !== null) {
        const raw = input.budgetRaw.trim();
        const parsed = raw ? parseBudgetInput(raw) : null;
        if (parsed) {
            data.budget = raw.slice(0, 200);
            data.budgetAmount = parsed.amount;
            data.budgetCurrency = parsed.currency;
        } else if (raw) {
            // Giữ nguyên văn để không mất thứ khách vừa gõ, nhưng XOÁ số đã chuẩn hoá:
            // để lại số cũ là bảng đơn hiện một giá còn chữ nói một giá khác.
            data.budget = raw.slice(0, 200);
            data.budgetAmount = null;
            data.budgetCurrency = null;
            budgetNote = '\n-# Ngân sách không đọc được thành số nên đơn này sẽ không lọc/sắp theo giá được.';
        }
    }

    await prisma.requestPost.update({ where: { id: input.id }, data });

    const shown = request.kind === 'PAID'
        ? formatBudget(
            (data.budgetAmount as number | null) ?? null,
            (data.budgetCurrency as string | null) ?? null,
            (data.budget as string | null) ?? null
        )
        : 'Đơn giúp đỡ (free)';

    return { message: `Đã cập nhật đơn #${input.id}. Ngân sách hiện tại: ${shown}.${budgetNote}` };
}
