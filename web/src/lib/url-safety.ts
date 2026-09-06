// Cong duy nhat cho link NGUOI DUNG NHAP (anh tham chieu cua don, link portfolio).
//
// `javascript:alert(1)` trong href la XSS that, va React KHONG chan cai nay — React chi
// escape noi dung, khong kiem tra scheme cua href. Nen moi link tu DB phai di qua day.
//
// Chi cho http va https. `data:` va `blob:` cung bi chan: mot `data:text/html,...` mo ra
// la mot trang do ke gui link viet, chay cung origin voi panel.
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Tra ve URL neu an toan de dat vao href, nguoc lai tra null. */
export function safeHttpUrl(raw: string): string | null {
    try {
        const url = new URL(raw);
        return ALLOWED_PROTOCOLS.has(url.protocol) ? url.toString() : null;
    } catch {
        // Khong parse duoc thi khong phai URL — khong doan, khong tu them "https://".
        return null;
    }
}
