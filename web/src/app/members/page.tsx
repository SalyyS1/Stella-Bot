"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BadgeCheck, Images } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar, SearchInput } from "@/components/filter-bar";
import { useListQuery } from "@/lib/use-list-query";
import { useDebounced } from "@/lib/use-debounced";
import { formatDate, formatNumber, shortId } from "@/lib/format";
import type { MemberSummary } from "@/lib/panel-types";

export default function MembersPage() {
    const router = useRouter();
    const [search, setSearch] = useState("");
    // Server tim theo Discord ID (chi chu so), nen o day cung chi gui chu so — gui ca dau
    // cach voi dau <@> la gui rac.
    const q = useDebounced(search.replace(/\D/g, ""));

    const { state, goToPage } = useListQuery<MemberSummary>("/api/members", { q });

    const columns: Column<MemberSummary>[] = [
        {
            key: "id",
            header: "Discord ID",
            className: "w-44",
            cell: member => (
                <span className="flex items-center gap-1 font-medium tabular-nums">
                    {shortId(member.id)}
                    {member.verified ? (
                        <BadgeCheck className="size-3.5 text-chart-2" aria-label="Đã xác minh" />
                    ) : null}
                    {member.hasPortfolio ? (
                        <Images className="size-3.5 text-muted-foreground" aria-label="Có portfolio" />
                    ) : null}
                </span>
            )
        },
        {
            key: "level",
            header: "Level",
            className: "w-24 tabular-nums",
            cell: member => (
                <div>
                    <p className="text-sm font-medium">{member.level}</p>
                    <p className="text-xs text-muted-foreground">{formatNumber(member.xp)} xp</p>
                </div>
            )
        },
        {
            key: "messages",
            header: "Tin nhắn",
            className: "w-28 text-sm tabular-nums",
            cell: member => formatNumber(member.totalMessages)
        },
        {
            key: "scoin",
            header: "Scoin",
            className: "w-28 text-sm tabular-nums",
            cell: member => formatNumber(member.scoinBalance)
        },
        {
            key: "contribution",
            header: "Điểm đóng góp",
            className: "w-32 text-sm tabular-nums",
            cell: member => formatNumber(member.contributionScore)
        },
        {
            key: "joined",
            header: "Vào server",
            className: "w-28 text-xs text-muted-foreground",
            cell: member => formatDate(member.joinedAt)
        }
    ];

    return (
        <>
            <PageHeader
                title="Thành viên"
                description="Sắp theo level. Tìm theo Discord ID — tên hiển thị nằm ở Discord, không có trong cơ sở dữ liệu."
            />

            <FilterBar>
                <SearchInput
                    value={search}
                    onChange={setSearch}
                    placeholder="Dán Discord ID…"
                />
            </FilterBar>

            <DataTable
                state={state}
                columns={columns}
                rowKey={member => member.id}
                emptyMessage={q ? "Không có ID nào khớp" : "Chưa có thành viên nào"}
                emptyHint={q ? "Kiểm tra lại ID — tìm theo tên thì không được." : undefined}
                onRowClick={member => router.push(`/members/detail/?id=${member.id}`)}
                onPageChange={goToPage}
            />
        </>
    );
}
