import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

export function PageHeader({
    title,
    description,
    actions
}: {
    title: string;
    description?: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                {description ? (
                    <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                ) : null}
            </div>
            {actions}
        </div>
    );
}

// Mau trang thai don. Chon theo nghia hanh dong: OPEN dang cho nguoi nhan (chu y),
// CLAIMED dang chay (binh thuong), RATED xong han (tot), CLOSED da dong (mo di).
const ORDER_STATUS: Record<string, { label: string; className: string }> = {
    OPEN: { label: "Đang mở", className: "bg-chart-3/15 text-chart-3 border-chart-3/30" },
    CLAIMED: { label: "Đã nhận", className: "bg-primary/15 text-primary border-primary/30" },
    DONE: { label: "Đã xong", className: "bg-chart-2/15 text-chart-2 border-chart-2/30" },
    RATED: { label: "Đã đánh giá", className: "bg-chart-2/15 text-chart-2 border-chart-2/30" },
    CLOSED: { label: "Đã đóng", className: "bg-muted text-muted-foreground border-border" }
};

export function OrderStatusBadge({ status }: { status: string }) {
    const meta = ORDER_STATUS[status];
    // Status la GIA TRI TU DB. Status moi them ben bot ma panel chua biet thi hien nguyen
    // van thay vi bien mat — bien mat la panel noi doi.
    if (!meta) return <Badge variant="outline">{status}</Badge>;
    return (
        <Badge variant="outline" className={meta.className}>
            {meta.label}
        </Badge>
    );
}

export function OpenForWorkBadge({ open }: { open: boolean | null }) {
    if (open === null) {
        return <Badge variant="outline" className="text-muted-foreground">Chưa lập hồ sơ</Badge>;
    }
    return open ? (
        <Badge variant="outline" className="border-chart-2/30 bg-chart-2/15 text-chart-2">
            Đang nhận việc
        </Badge>
    ) : (
        <Badge variant="outline" className="text-muted-foreground">Tạm nghỉ</Badge>
    );
}
