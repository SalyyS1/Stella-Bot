import prisma from '../../lib/prisma';

// Hồ sơ nhận việc: đang nhận việc hay không, một dòng tự giới thiệu, bảng giá.
//
// `/profile` trả lời "người này đáng tin tới đâu" (rating, số job, tick verified) và
// `/portfolio` trả lời "đã làm ra cái gì". File này trả lời câu khách hỏi ĐẦU TIÊN: bao
// nhiêu tiền, và có đang rảnh không.
//
// Bảng riêng chứ không thêm cột vào `User`: bảng đó đã 20+ cột và 15 quan hệ, và ở đây cần
// `updatedAt` RIÊNG — bảng giá 6 tháng chưa sửa là bảng giá gây hiểu lầm, phải hiện được
// "cập nhật lần cuối". Dùng `updatedAt` của User thì mỗi lần cộng XP là bảng giá lại trông
// như vừa mới cập nhật.

// Trần độ dài cắt Ở ĐÂY, không chỉ ở modal: `setMaxLength` của modal là kiểm phía client,
// và mọi kiểm phía client đều bỏ qua được. Một `priceText` 4000 ký tự làm vỡ embed (trần
// 1024/field, 6000/embed) và biến hồ sơ thành công cụ spam.
export const MAX_HEADLINE = 100;
export const MAX_PRICE_TEXT = 1000;

export interface ServiceProfile {
    userId: string;
    openForWork: boolean;
    headline: string | null;
    priceText: string | null;
    updatedAt: Date;
}

function isUserId(value: string): boolean {
    return /^\d{5,25}$/.test(value);
}

/** Rỗng-hoá chuỗi trắng: người xoá hết nội dung trong modal là muốn bỏ trường đó. */
function trimToNull(value: string | null | undefined, max: number): string | null {
    if (value === null || value === undefined) return null;
    const trimmed = value.trim().slice(0, max);
    return trimmed.length > 0 ? trimmed : null;
}

export async function getServiceProfile(userId: string): Promise<ServiceProfile | null> {
    if (!isUserId(userId)) return null;
    return prisma.freelancerProfile.findUnique({
        where: { userId },
        select: { userId: true, openForWork: true, headline: true, priceText: true, updatedAt: true }
    }).catch(error => {
        console.error('[freelancer] getServiceProfile failed:', error);
        return null;
    });
}

/**
 * Ghi headline + bảng giá. Upsert chứ không có luồng "tạo trước rồi sửa": người dùng không
 * nên phải biết hồ sơ của họ đã tồn tại trong DB hay chưa.
 *
 * `openForWork` KHÔNG bị ghi ở đây — sửa bảng giá không được âm thầm bật lại trạng thái
 * nhận việc của người đang tắt.
 */
export async function saveServiceProfile(
    userId: string,
    input: { headline?: string | null; priceText?: string | null }
): Promise<ServiceProfile | null> {
    if (!isUserId(userId)) return null;
    const headline = trimToNull(input.headline, MAX_HEADLINE);
    const priceText = trimToNull(input.priceText, MAX_PRICE_TEXT);

    return prisma.freelancerProfile.upsert({
        where: { userId },
        update: { headline, priceText },
        create: { userId, headline, priceText },
        select: { userId: true, openForWork: true, headline: true, priceText: true, updatedAt: true }
    }).catch(error => {
        console.error('[freelancer] saveServiceProfile failed:', error);
        return null;
    });
}

/**
 * Bật/tắt trạng thái nhận việc.
 *
 * Đây là THÔNG TIN, không phải cổng chặn: `closed` vẫn bấm được nút "Nhận job" ở đơn hàng.
 * Chặn ngầm ở đó sẽ thành lỗi "bấm không thấy gì xảy ra" mà không ai đoán được nguyên nhân.
 */
export async function setOpenForWork(userId: string, open: boolean): Promise<ServiceProfile | null> {
    if (!isUserId(userId)) return null;
    return prisma.freelancerProfile.upsert({
        where: { userId },
        update: { openForWork: open },
        create: { userId, openForWork: open },
        select: { userId: true, openForWork: true, headline: true, priceText: true, updatedAt: true }
    }).catch(error => {
        console.error('[freelancer] setOpenForWork failed:', error);
        return null;
    });
}
