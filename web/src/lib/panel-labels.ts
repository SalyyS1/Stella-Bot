// Nhan hien thi cho cac gia tri enum tu DB.
//
// `SKILL_LABELS` la ban sao cua `config.skills` ben bot (src/config.ts). Bot doi danh
// sach ky nang thi phai sua o day — nen ham `skillLabel` tra ve NGUYEN KHOA khi khong
// biet, thay vi "Khác": mot khoa moi hien ra nguyen van thi thay ngay va sua duoc, con
// gop het vao "Khác" thi khong ai biet la panel da lac hau.

export const SKILL_LABELS: Record<string, string> = {
    design: "Design / Art",
    dev: "Development / Plugin",
    video: "Video / Motion",
    writing: "Writing / Content",
    other: "Khác"
};

export function skillLabel(skill: string | null): string {
    if (!skill) return "—";
    return SKILL_LABELS[skill] ?? skill;
}

export const SKILL_OPTIONS = Object.entries(SKILL_LABELS).map(([value, label]) => ({
    value,
    label
}));

export const ORDER_STATUS_OPTIONS = [
    { value: "OPEN", label: "Đang mở" },
    { value: "CLAIMED", label: "Đã nhận" },
    { value: "DONE", label: "Đã xong" },
    { value: "RATED", label: "Đã đánh giá" },
    { value: "CLOSED", label: "Đã đóng" }
];

/** `RequestKind` ben bot: chi co hai gia tri. */
export const ORDER_KIND_OPTIONS = [
    { value: "PAID", label: "Có trả phí" },
    { value: "FREE", label: "Miễn phí" }
];

export function kindLabel(kind: string): string {
    return ORDER_KIND_OPTIONS.find(option => option.value === kind)?.label ?? kind;
}

/**
 * Trang thai showcase panel duoc phep xem — CHINH XAC bang `VIEWABLE_STATUS` ben
 * src/panel/data/showcase-queries.ts. Khong co "tat ca": server luon loc dung MOT trang
 * thai va tra ve PUBLISHED khi tham so thieu hoac la. `OPTED_OUT` co tinh khong co o day
 * — do la bai tac gia da xin khong dang.
 */
export const SHOWCASE_STATUS_OPTIONS = [
    { value: "PUBLISHED", label: "Đã đăng" },
    { value: "VOTING", label: "Đang vote" },
    { value: "PUBLISHING", label: "Đang đăng" }
];

export const DEFAULT_SHOWCASE_STATUS = "PUBLISHED";

/** Don da xong/da dong thi han cu khong con la viec can lam. */
export const CLOSED_ORDER_STATUSES = new Set(["DONE", "RATED", "CLOSED"]);
