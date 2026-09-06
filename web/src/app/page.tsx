"use client";

import {
    Briefcase, Clock, Coins, MessageSquareWarning, Star, TimerOff
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { ErrorBlock, LoadingBlock } from "@/components/data-state";
import { BudgetChart, OrderTrendChart } from "@/components/dashboard-charts";
import { useApi } from "@/lib/use-api";
import { formatNumber, timeAgo } from "@/lib/format";
import type { BudgetBucket, CommunityOverview, OrderTrend } from "@/lib/panel-types";

// Dashboard la trang duy nhat tu lam moi (60s). Cac bang danh sach thi khong: dang doc ma
// bang tu nhay la kho chiu, con o day con so cu la con so noi doi.
const REFETCH_MS = 60_000;

/** 4.23 -> "4.2". null -> "—" (chua co danh gia nao, khong phai 0 diem). */
function formatRating(avg: number | null): string {
    return avg === null ? "—" : avg.toFixed(1);
}

/** Chenh lech 30 ngay nay so voi 30 ngay truoc, chi khi CA HAI ky deu co danh gia. */
function ratingDelta(now: number | null, prev: number | null): string | null {
    if (now === null || prev === null) return null;
    const diff = now - prev;
    if (Math.abs(diff) < 0.05) return "đi ngang so với 30 ngày trước";
    return `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff).toFixed(1)} so với 30 ngày trước`;
}

function CountBreakdown({ title, counts }: { title: string; counts: Record<string, number> }) {
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return (
        <div>
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            {entries.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">Chưa có dữ liệu</p>
            ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {entries.map(([key, value]) => (
                        <Badge key={key} variant="outline" className="font-normal">
                            {key}
                            <span className="ml-1 font-semibold tabular-nums">{formatNumber(value)}</span>
                        </Badge>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function DashboardPage() {
    const overview = useApi<CommunityOverview>("/api/overview", { refetchMs: REFETCH_MS });
    const trend = useApi<OrderTrend>("/api/trends", { refetchMs: REFETCH_MS });
    const budget = useApi<BudgetBucket[]>("/api/budget-distribution", { refetchMs: REFETCH_MS });

    const data = overview.data;

    return (
        <>
            <PageHeader
                title="Tổng quan"
                description={
                    data
                        ? `Số liệu tính ${timeAgo(data.generatedAt)} · tự làm mới mỗi phút`
                        : "Đang tải số liệu cộng đồng"
                }
            />

            {overview.error ? (
                <Card className="mb-4 py-0">
                    <ErrorBlock message={overview.error} onRetry={overview.reload} />
                </Card>
            ) : !data ? (
                <Card className="mb-4 px-4 py-2">
                    <LoadingBlock rows={3} />
                </Card>
            ) : (
                <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <StatCard
                        label="Đơn đang chạy"
                        value={formatNumber(data.orders.activeTotal)}
                        hint="Đơn chưa đóng, tính cả đang mở và đã nhận"
                        icon={<Briefcase className="size-4" />}
                    />
                    <StatCard
                        label="Chưa ai nhận > 48h"
                        value={formatNumber(data.orders.unclaimedTooLong)}
                        hint={
                            data.orders.unclaimedTooLong > 0
                                ? "Cần đẩy tin hoặc hỏi lại người đăng"
                                : "Không có đơn nào bị bỏ quên"
                        }
                        tone={data.orders.unclaimedTooLong > 0 ? "warn" : "good"}
                        icon={<Clock className="size-4" />}
                    />
                    <StatCard
                        label="Quá hạn"
                        value={formatNumber(data.orders.overdue)}
                        hint={
                            data.orders.overdue > 0
                                ? "Đã qua hạn mà chưa xong — nhắc người nhận"
                                : "Chưa có đơn nào trễ hạn"
                        }
                        tone={data.orders.overdue > 0 ? "warn" : "good"}
                        icon={<TimerOff className="size-4" />}
                    />
                    <StatCard
                        label="Ticket đang mở"
                        value={formatNumber(data.openTickets)}
                        hint={
                            data.openTickets > 0
                                ? "Có người đang chờ trả lời"
                                : "Không còn ticket nào chờ"
                        }
                        tone={data.openTickets > 0 ? "warn" : "good"}
                        icon={<MessageSquareWarning className="size-4" />}
                    />
                    <StatCard
                        label="Đánh giá 30 ngày"
                        value={
                            <>
                                {formatRating(data.rating30d.avg)}
                                <span className="ml-1 text-base font-normal text-muted-foreground">/5</span>
                            </>
                        }
                        hint={
                            ratingDelta(data.rating30d.avg, data.ratingPrev30d.avg) ??
                            `${formatNumber(data.rating30d.count)} lượt đánh giá`
                        }
                        tone={data.rating30d.avg !== null && data.rating30d.avg < 3.5 ? "warn" : "default"}
                        icon={<Star className="size-4" />}
                    />
                    <StatCard
                        label="Scoin lưu hành"
                        value={formatNumber(data.scoinInCirculation)}
                        hint={`${formatNumber(data.newMembers7d)} thành viên mới trong 7 ngày`}
                        icon={<Coins className="size-4" />}
                    />
                </div>
            )}

            <div className="mb-4 grid gap-3 lg:grid-cols-2">
                <OrderTrendChart state={trend} />
                <BudgetChart state={budget} />
            </div>

            {data ? (
                <Card className="gap-0">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base font-medium">Đơn theo nhóm</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-4 sm:grid-cols-2">
                        <CountBreakdown title="Theo trạng thái" counts={data.orders.byStatus} />
                        <CountBreakdown title="Theo loại" counts={data.orders.byKind} />
                    </CardContent>
                </Card>
            ) : null}
        </>
    );
}
