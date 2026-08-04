import { Attachment } from 'discord.js';

// Quyết định URL ảnh nào được phép đưa cho AI đọc. Tách riêng khỏi
// report-image-collector vì cả nhật báo và chat Q&A đều cần đúng một danh sách
// host này — hai bản copy sẽ lệch nhau ngay lần đầu ai đó sửa một bên.
//
// URL được giao cho gateway AI để nó tự tải về, nên đây là chỗ DUY NHẤT quyết
// định request đó được đi tới host nào. Không nới lỏng mà không nghĩ về SSRF.

const ALLOWED_IMAGE_HOSTS = new Set([
    'cdn.discordapp.com',
    'media.discordapp.net'
]);

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

export function isAllowedImageUrl(raw: string): boolean {
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:') return false;
        if (!ALLOWED_IMAGE_HOSTS.has(url.hostname.toLowerCase())) return false;
        // Đuôi file kiểm trên PATH, không phải cả URL: link Discord CDN mang theo
        // query (?ex=&is=&hm=) nên endsWith trên cả chuỗi sẽ luôn sai.
        const path = url.pathname.toLowerCase();
        return IMAGE_EXTENSIONS.some(ext => path.endsWith(ext));
    } catch {
        return false;
    }
}

// Lọc attachment của một tin nhắn thành danh sách URL ảnh hợp lệ, cắt theo maxCount
// và maxBytes. Trả URL NGUYÊN VẸN (cả query) — gateway tải ảnh server-side và
// chữ ký nằm trong ?ex=&is=&hm=, bỏ query là ảnh thành lỗi tải.
export function pickImageUrls(
    attachments: Iterable<Attachment>,
    maxCount: number,
    maxBytes: number
): string[] {
    const urls: string[] = [];
    for (const attachment of attachments) {
        if (urls.length >= maxCount) break;
        if (!isAllowedImageUrl(attachment.url)) continue;
        if (attachment.size > maxBytes) continue;
        urls.push(attachment.url);
    }
    return urls;
}
