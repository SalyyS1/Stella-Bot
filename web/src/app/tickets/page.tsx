"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar, FilterSelect } from "@/components/filter-bar";
import { useListQuery } from "@/lib/use-list-query";
import { formatDate, formatHours, shortId, timeAgo } from "@/lib/format";
import type { TicketRow } from "@/lib/panel-types";
import { cn } from "@/lib/utils";

// Ticket mo qua lau la viec can lam ngay: co nguoi dang ngoi cho tra loi.
const SLOW_TICKET_HOURS = 48;

export default function TicketsPage() {
    // `open` la ba trang thai: "true" chi mo, "false" chi dong, khong chon = tat ca —
    // dung y nhu `TicketFilter.open` ben bot.
    const [open, setOpen] = useState<string | undefined>("true");

    const { state, goToPage } = useListQuery<TicketRow>("/api/tickets", { open });

    const columns: Column<TicketRow>[] = [
        {
            key: "id",
            header: "#",
            className: "w-14 tabular-nums text-muted-foreground",
            cell: ticket => ticket.id
        },
        {
            key: "topic",
            header: "Chủ đề",
            className: "max-w-[340px]",
            cell: ticket => <p className="truncate font-medium">{ticket.topic}</p>
        },
        {
            key: "opener",
            header: "Người mở",
            className: "w-36 text-xs tabular-nums text-muted-foreground",
            cell: ticket => shortId(ticket.openerId)
        },
        {
            key: "claimed",
            header: "Người nhận",
            className: "w-36 text-xs tabular-nums text-muted-foreground",
            cell: ticket =>
                ticket.claimedBy ? (
                    shortId(ticket.claimedBy)
                ) : (
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
                        chưa ai
                    </Badge>
                )
        },
        {
            key: "age",
            header: "Tuổi",
            className: "w-28 text-sm",
            cell: ticket => {
                const slow = ticket.closedAt === null && ticket.ageHours >= SLOW_TICKET_HOURS;
                return (
                    <span className={cn(slow && "font-medium text-destructive")}>
                        {formatHours(ticket.ageHours)}
                    </span>
                );
            }
        },
        {
            key: "status",
            header: "Trạng thái",
            className: "w-40",
            cell: ticket =>
                ticket.closedAt === null ? (
                    <Badge variant="outline" className="border-chart-3/30 bg-chart-3/15 text-chart-3">
                        Đang mở
                    </Badge>
                ) : (
                    <div>
                        <Badge variant="outline" className="text-muted-foreground">
                            Đã đóng
                        </Badge>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {formatDate(ticket.closedAt)}
                            {ticket.closedBy ? ` · ${shortId(ticket.closedBy)}` : ""}
                        </p>
                    </div>
                )
        },
        {
            key: "created",
            header: "Mở lúc",
            className: "w-28 text-xs text-muted-foreground",
            cell: ticket => timeAgo(ticket.createdAt)
        }
    ];

    return (
        <>
            <PageHeader
                title="Ticket"
                description={`Mặc định chỉ hiện ticket đang mở. Quá ${SLOW_TICKET_HOURS} giờ chưa đóng thì tô đỏ.`}
            />

            <FilterBar>
                <FilterSelect
                    value={open}
                    onChange={setOpen}
                    options={[
                        { value: "true", label: "Đang mở" },
                        { value: "false", label: "Đã đóng" }
                    ]}
                    allLabel="Tất cả"
                    width="w-[160px]"
                />
            </FilterBar>

            <DataTable
                state={state}
                columns={columns}
                rowKey={ticket => String(ticket.id)}
                emptyMessage={
                    open === "true" ? "Không còn ticket nào đang mở" : "Không có ticket nào khớp bộ lọc"
                }
                emptyHint={open === "true" ? "Mọi người đã được trả lời." : undefined}
                onPageChange={goToPage}
            />
        </>
    );
}
