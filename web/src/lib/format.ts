// Format hien thi dung chung. Tien KHONG format o day — server da format bang
// formatBudget va tra ve `budgetLabel`; client chi hien chuoi nhan duoc. Hai cho format
// tien la hai cho se lech.

/** "2026-09-02T08:12:00.000Z" -> "02/09/2026". */
export function formatDate(iso: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Khoang cach toi gio hien tai, kieu "3 ngày trước" / "2 giờ trước". */
export function timeAgo(iso: string | null): string {
    if (!iso) return "—";
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "—";
    const diffMs = Date.now() - then;
    const minutes = Math.round(diffMs / 60_000);
    if (minutes < 1) return "vừa xong";
    if (minutes < 60) return `${minutes} phút trước`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} giờ trước`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days} ngày trước`;
    const months = Math.round(days / 30);
    if (months < 12) return `${months} tháng trước`;
    return `${Math.round(months / 12)} năm trước`;
}

/** So gio -> "3 ngày 6 giờ" (cho tuoi ticket). */
export function formatHours(hours: number): string {
    if (!Number.isFinite(hours) || hours < 0) return "—";
    if (hours < 24) return `${hours} giờ`;
    const days = Math.floor(hours / 24);
    const rest = hours % 24;
    return rest > 0 ? `${days} ngày ${rest} giờ` : `${days} ngày`;
}

/** So voice giay -> "51 giờ 15 phút". */
export function formatVoiceSeconds(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return "0 phút";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours === 0) return `${minutes} phút`;
    return minutes > 0 ? `${hours} giờ ${minutes} phút` : `${hours} giờ`;
}

/** 96483 -> "96.483" theo kieu Viet. */
export function formatNumber(value: number): string {
    return value.toLocaleString("vi-VN");
}

/**
 * Rut gon Discord ID cho bang danh sach: "1243…3003". ID day du chi hien o trang chi
 * tiet — anh chup man hinh panel se bi gui cho nguoi khac.
 */
export function shortId(id: string): string {
    return id.length <= 10 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`;
}
