"use client";

import { useState } from "react";
import { BadgeCheck, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { OpenForWorkBadge, PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar, FilterSelect } from "@/components/filter-bar";
import { useListQuery } from "@/lib/use-list-query";
import { formatNumber, shortId, timeAgo } from "@/lib/format";
import type { FreelancerRow } from "@/lib/panel-types";

// Giong STALE_AFTER_DAYS ben src/systems/freelancer/freelancer-profile-view.ts: ho so
// khong sua 90 ngay thi bang gia da co the khong con dung.
const STALE_AFTER_DAYS = 90;

function isStale(updatedAt: string | null): boolean {
    if (!updatedAt) return false;
    const then = new Date(updatedAt).getTime();
    if (!Number.isFinite(then)) return false;
    return Date.now() - then > STALE_AFTER_DAYS * 86_400_000;
}

export default function FreelancersPage() {
    // Hop dong that chi co `openOnly?: boolean`, va `false` khong loc gi — nen o day chi
    // co hai lua chon: tat ca, hoac chi nguoi dang nhan viec.
    const [openOnly, setOpenOnly] = useState<string | undefined>();

    const { state, goToPage } = useListQuery<FreelancerRow>("/api/freelancers", { openOnly });

    const columns: Column<FreelancerRow>[] = [
        {
            key: "user",
            header: "Thành viên",
            className: "max-w-[300px]",
            cell: row => (
                <div>
                    <p className="flex items-center gap-1 font-medium tabular-nums">
                        {shortId(row.userId)}
                        {row.verified ? (
                            <BadgeCheck className="size-3.5 text-chart-2" aria-label="Đã xác minh" />
                        ) : null}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {row.headline ?? "Chưa ghi giới thiệu"}
                    </p>
                </div>
            )
        },
        {
            key: "rating",
            header: "Đánh giá",
            className: "w-32",
            cell: row => (
                <div className="text-sm">
                    {row.avgRating === null ? (
                        <span className="text-muted-foreground">Chưa có</span>
                    ) : (
                        <span className="flex items-center gap-1 tabular-nums">
                            <Star className="size-3.5 fill-chart-4 text-chart-4" />
                            {row.avgRating.toFixed(1)}
                        </span>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatNumber(row.jobCount)} đơn đã nhận
                    </p>
                </div>
            )
        },
        {
            key: "open",
            header: "Nhận việc",
            className: "w-36",
            cell: row => <OpenForWorkBadge open={row.openForWork} />
        },
        {
            key: "price",
            header: "Bảng giá",
            className: "max-w-[260px] text-xs text-muted-foreground",
            cell: row =>
                row.priceText ? (
                    // Bang gia co the nhieu dong; bang danh sach chi hien dong dau.
                    <span className="line-clamp-2 whitespace-pre-wrap">{row.priceText}</span>
                ) : (
                    "Chưa ghi"
                )
        },
        {
            key: "updated",
            header: "Sửa hồ sơ",
            className: "w-32 text-xs text-muted-foreground",
            cell: row => (
                <span>
                    {timeAgo(row.profileUpdatedAt)}
                    {isStale(row.profileUpdatedAt) ? (
                        <Badge
                            variant="outline"
                            className="mt-1 block w-fit border-chart-3/30 bg-chart-3/15 text-[10px] font-normal text-chart-3"
                        >
                            hồ sơ cũ
                        </Badge>
                    ) : null}
                </span>
            )
        }
    ];

    return (
        <>
            <PageHeader
                title="Người nhận việc"
                description="Ai đang nhận việc, điểm đánh giá và bảng giá họ tự ghi."
            />

            <FilterBar>
                <FilterSelect
                    value={openOnly}
                    onChange={setOpenOnly}
                    options={[{ value: "true", label: "Đang nhận việc" }]}
                    allLabel="Tất cả"
                    width="w-[180px]"
                />
            </FilterBar>

            <DataTable
                state={state}
                columns={columns}
                rowKey={row => row.userId}
                emptyMessage="Chưa có ai lập hồ sơ nhận việc"
                emptyHint="Thành viên lập hồ sơ bằng lệnh /freelancer edit trong Discord."
                onPageChange={goToPage}
            />
        </>
    );
}
