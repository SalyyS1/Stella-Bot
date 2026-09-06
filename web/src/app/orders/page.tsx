"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { PageHeader, OrderStatusBadge } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar, FilterSelect } from "@/components/filter-bar";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate, shortId, timeAgo } from "@/lib/format";
import {
    CLOSED_ORDER_STATUSES, ORDER_KIND_OPTIONS, ORDER_STATUS_OPTIONS, SKILL_OPTIONS,
    kindLabel, skillLabel
} from "@/lib/panel-labels";
import type { OrderListItem } from "@/lib/panel-types";
import { cn } from "@/lib/utils";

/** Han da qua ma don chua xong = viec can lam ngay, nen to do. */
function isOverdue(order: OrderListItem): boolean {
    if (!order.dueDate || CLOSED_ORDER_STATUSES.has(order.status)) return false;
    const due = new Date(order.dueDate).getTime();
    return Number.isFinite(due) && due < Date.now();
}

export default function OrdersPage() {
    const router = useRouter();
    const [status, setStatus] = useState<string | undefined>();
    const [kind, setKind] = useState<string | undefined>();
    const [skill, setSkill] = useState<string | undefined>();

    const { state, goToPage } = useListQuery<OrderListItem>("/api/orders", { status, kind, skill });

    const columns: Column<OrderListItem>[] = [
        {
            key: "id",
            header: "#",
            className: "w-14 tabular-nums text-muted-foreground",
            cell: order => order.id
        },
        {
            key: "service",
            header: "Dịch vụ",
            className: "max-w-[320px]",
            cell: order => (
                <div>
                    <p className="truncate font-medium">{order.service}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        {skillLabel(order.skill)} · {kindLabel(order.kind)}
                        {order.hasOrderChannel ? " · có kênh riêng" : ""}
                    </p>
                </div>
            )
        },
        {
            key: "status",
            header: "Trạng thái",
            className: "w-32",
            cell: order => <OrderStatusBadge status={order.status} />
        },
        {
            key: "budget",
            header: "Ngân sách",
            className: "w-36 text-sm",
            cell: order => order.budgetLabel
        },
        {
            key: "due",
            header: "Hạn",
            className: "w-28 text-sm",
            cell: order => (
                <span className={cn(isOverdue(order) && "font-medium text-destructive")}>
                    {formatDate(order.dueDate)}
                </span>
            )
        },
        {
            key: "people",
            header: "Đăng → nhận",
            className: "w-40 text-xs text-muted-foreground",
            cell: order => (
                <span className="tabular-nums">
                    {shortId(order.requesterId)}
                    {" → "}
                    {order.claimedById ? (
                        shortId(order.claimedById)
                    ) : (
                        <Badge variant="outline" className="ml-0.5 h-5 px-1.5 text-[10px] font-normal">
                            chưa ai
                        </Badge>
                    )}
                </span>
            )
        },
        {
            key: "updated",
            header: "Cập nhật",
            className: "w-28 text-xs text-muted-foreground",
            cell: order => timeAgo(order.updatedAt)
        }
    ];

    return (
        <>
            <PageHeader
                title="Đơn hàng"
                description="Toàn bộ đơn trong cộng đồng. Bấm một dòng để xem chi tiết."
            />

            <FilterBar>
                <FilterSelect
                    value={status}
                    onChange={setStatus}
                    options={ORDER_STATUS_OPTIONS}
                    allLabel="Mọi trạng thái"
                />
                <FilterSelect
                    value={kind}
                    onChange={setKind}
                    options={ORDER_KIND_OPTIONS}
                    allLabel="Mọi loại"
                    width="w-[150px]"
                />
                <FilterSelect
                    value={skill}
                    onChange={setSkill}
                    options={SKILL_OPTIONS}
                    allLabel="Mọi kỹ năng"
                    width="w-[200px]"
                />
            </FilterBar>

            <DataTable
                state={state}
                columns={columns}
                rowKey={order => String(order.id)}
                emptyMessage="Không có đơn nào khớp bộ lọc"
                emptyHint="Thử bỏ một bộ lọc, hoặc kiểm tra lại kỹ năng đã chọn."
                onRowClick={order => router.push(`/orders/detail/?id=${order.id}`)}
                onPageChange={goToPage}
            />
        </>
    );
}
