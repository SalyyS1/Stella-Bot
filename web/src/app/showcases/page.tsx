"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar, FilterSelect, SearchInput } from "@/components/filter-bar";
import { useListQuery } from "@/lib/use-list-query";
import { useDebounced } from "@/lib/use-debounced";
import { formatDate, shortId, timeAgo } from "@/lib/format";
import { DEFAULT_SHOWCASE_STATUS, SHOWCASE_STATUS_OPTIONS } from "@/lib/panel-labels";
import type { ShowcaseRow } from "@/lib/panel-types";

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
    SHOWCASE_STATUS_OPTIONS.map(option => [option.value, option.label])
);

export default function ShowcasesPage() {
    // Bo loc trang thai KHONG co "tat ca": tang du lieu luon loc dung mot trang thai va
    // tra ve PUBLISHED khi tham so thieu. Cho chon "tat ca" o day nghia la giao dien noi
    // mot dieu ma server khong lam.
    const [status, setStatus] = useState<string>(DEFAULT_SHOWCASE_STATUS);
    const [search, setSearch] = useState("");
    const authorId = useDebounced(search.replace(/\D/g, ""));

    const { state, goToPage } = useListQuery<ShowcaseRow>("/api/showcases", { status, authorId });

    const columns: Column<ShowcaseRow>[] = [
        {
            key: "title",
            header: "Tiêu đề",
            className: "max-w-[360px]",
            cell: row => (
                <div>
                    <p className="truncate font-medium">{row.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                        {/* Khong lam link duoc: link tin nhan Discord can guildId, ma API
                            panel khong tra guildId. Hien ma de admin tu tra khi can. */}
                        msg {row.messageId}
                    </p>
                </div>
            )
        },
        {
            key: "tag",
            header: "Thẻ",
            className: "w-28",
            cell: row => (
                <Badge variant="outline" className="font-normal">
                    {row.tagName}
                </Badge>
            )
        },
        {
            key: "author",
            header: "Tác giả",
            className: "w-36 text-xs tabular-nums text-muted-foreground",
            cell: row => shortId(row.authorId)
        },
        {
            key: "status",
            header: "Trạng thái",
            className: "w-32",
            cell: row => (
                <Badge variant="outline" className="font-normal">
                    {STATUS_LABELS[row.status] ?? row.status}
                </Badge>
            )
        },
        {
            key: "thread",
            header: "Thread diễn đàn",
            className: "w-36 text-xs text-muted-foreground",
            cell: row =>
                row.forumThreadId ? (
                    <span className="tabular-nums">{row.forumThreadId}</span>
                ) : (
                    "Chưa có"
                )
        },
        {
            key: "published",
            header: "Đăng lúc",
            className: "w-32 text-xs text-muted-foreground",
            cell: row =>
                row.publishedAt ? (
                    <span title={formatDate(row.publishedAt)}>{timeAgo(row.publishedAt)}</span>
                ) : (
                    `tạo ${timeAgo(row.createdAt)}`
                )
        }
    ];

    return (
        <>
            <PageHeader
                title="Showcase"
                description="Bài khoe thành phẩm. Bài tác giả đã xin ẩn không xuất hiện ở đây, kể cả với admin."
            />

            <FilterBar>
                <FilterSelect
                    value={status}
                    onChange={next => setStatus(next ?? DEFAULT_SHOWCASE_STATUS)}
                    options={SHOWCASE_STATUS_OPTIONS}
                    width="w-[160px]"
                />
                <SearchInput
                    value={search}
                    onChange={setSearch}
                    placeholder="Lọc theo Discord ID tác giả…"
                />
            </FilterBar>

            <DataTable
                state={state}
                columns={columns}
                rowKey={row => row.messageId}
                emptyMessage="Không có bài nào khớp bộ lọc"
                emptyHint={
                    authorId
                        ? "Kiểm tra lại ID tác giả, hoặc đổi trạng thái đang lọc."
                        : "Thử đổi trạng thái đang lọc."
                }
                onPageChange={goToPage}
            />
        </>
    );
}
