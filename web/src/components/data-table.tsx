"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/data-state";
import type { Fetched } from "@/lib/use-api";
import type { Page } from "@/lib/panel-types";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

// Mot bang cho ca bon trang danh sach. Viet mot lan — dung nhu ben bot: khong copy bang
// bon lan roi sua ba cho quen mot cho.

export interface Column<T> {
    key: string;
    header: ReactNode;
    /** Noi dung o. Tra ReactNode de cot co the la badge, link, nhieu dong. */
    cell: (row: T) => ReactNode;
    className?: string;
}

export function DataTable<T>({
    state,
    columns,
    rowKey,
    emptyMessage,
    emptyHint,
    onRowClick,
    onPageChange
}: {
    state: Fetched<Page<T>>;
    columns: Column<T>[];
    rowKey: (row: T) => string;
    emptyMessage: string;
    emptyHint?: ReactNode;
    onRowClick?: (row: T) => void;
    /** Bo trong thi bang khong co nut sang trang (dung cho bang ngan, khong phan trang). */
    onPageChange?: (page: number) => void;
}) {
    const { data, error, loading, reload } = state;

    return (
        <Card className="overflow-hidden py-0">
            {error ? (
                <ErrorBlock message={error} onRetry={reload} />
            ) : loading && !data ? (
                <div className="px-4">
                    <LoadingBlock />
                </div>
            ) : !data || data.items.length === 0 ? (
                <EmptyBlock message={emptyMessage} hint={emptyHint} />
            ) : (
                <>
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                {columns.map(col => (
                                    <TableHead key={col.key} className={col.className}>
                                        {col.header}
                                    </TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {data.items.map(row => (
                                <TableRow
                                    key={rowKey(row)}
                                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                                    className={cn(onRowClick && "cursor-pointer")}
                                >
                                    {columns.map(col => (
                                        <TableCell key={col.key} className={col.className}>
                                            {col.cell(row)}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
                        <span>
                            {formatNumber(data.items.length)} / {formatNumber(data.total)} dòng
                        </span>
                        <div className="flex items-center gap-2">
                            <span>
                                Trang {data.page}/{data.pageCount}
                            </span>
                            {onPageChange ? (
                                <>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="size-7"
                                        // Dang tai thi chan bam tiep: bam nhanh hai lan se lam trang
                                        // nhay qua ket qua cu.
                                        disabled={loading || data.page <= 1}
                                        onClick={() => onPageChange(data.page - 1)}
                                        aria-label="Trang trước"
                                    >
                                        <ChevronLeft className="size-4" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="size-7"
                                        disabled={loading || data.page >= data.pageCount}
                                        onClick={() => onPageChange(data.page + 1)}
                                        aria-label="Trang sau"
                                    >
                                        <ChevronRight className="size-4" />
                                    </Button>
                                </>
                            ) : null}
                        </div>
                    </div>
                </>
            )}
        </Card>
    );
}
