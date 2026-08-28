import { Attachment, Collection } from 'discord.js';
import { config } from '../../config';

// Kiểm ảnh tham khảo mà khách gửi kèm khi đặt đơn.
//
// `file_types: ['image']` đặt trên FileUploadBuilder chỉ là GỢI Ý cho hộp chọn file của
// Discord — nó lọc giúp người dùng, nó không phải cổng chặn. Payload đến từ client, và
// client thì sửa được. Vì vậy đếm lại số file và kiểm lại contentType ở đây.
//
// Số file cũng phải kiểm lại: max_values trong modal cũng là giới hạn phía client.

export interface ReferenceValidation {
    urls: string[];
    error: string | null;
}

export function validateReferenceImages(
    attachments: Collection<string, Attachment> | null | undefined
): ReferenceValidation {
    if (!attachments || attachments.size === 0) return { urls: [], error: null };

    const max = config.request.maxReferenceFiles;
    if (attachments.size > max) {
        return { urls: [], error: `Chỉ nhận tối đa ${max} ảnh tham khảo (bạn gửi ${attachments.size}).` };
    }

    const notImage = attachments.find(a => !a.contentType?.startsWith('image/'));
    if (notImage) {
        return { urls: [], error: `"${notImage.name}" không phải ảnh. Chỉ nhận ảnh tham khảo (png, jpg, gif, webp...).` };
    }

    return { urls: attachments.map(a => a.url), error: null };
}

// URL CDN của Discord HẾT HẠN (có tham số ký kèm thời hạn). Lưu để xem ngay trong lúc
// đơn còn sống, KHÔNG phải để lưu trữ lâu dài — đơn đóng vài tuần rồi mở lại xem thì
// ảnh sẽ hỏng. Muốn lưu lâu thì phải tải file về, đó là việc của đợt khác.
export function serializeReferenceUrls(urls: string[]): string | null {
    return urls.length > 0 ? JSON.stringify(urls) : null;
}

export function parseReferenceUrls(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string') : [];
    } catch {
        return [];
    }
}
