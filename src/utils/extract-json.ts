// Cắt phần rào quanh JSON nếu model vẫn bọc ```json dù đã bị dặn — dùng chung cho
// mọi lượt AI trả JSON (bộ đọc lời nhắc, trang nhất tờ báo...). Trả '' khi không
// tìm thấy khối JSON nào; caller tự xử lý null.
export function extractJson(raw: string): string {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fenced ? fenced[1] : raw;
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start) return '';
    return body.slice(start, end + 1);
}
