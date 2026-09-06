"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig
} from "@/components/ui/chart";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/data-state";
import type { Fetched } from "@/lib/use-api";
import type { BudgetBucket, OrderTrend } from "@/lib/panel-types";

// Khung chung cho ca hai bieu do: bieu do cung phai co ba trang thai nhu bang. Bieu do
// trong khac bieu do loi — ve mot cai truc rong roi im lang la panel noi doi.
function ChartCard({
    title,
    subtitle,
    state,
    isEmpty,
    emptyMessage,
    children
}: {
    title: string;
    subtitle?: string;
    state: { error: string | null; loading: boolean; reload: () => void; hasData: boolean };
    isEmpty: boolean;
    emptyMessage: string;
    children: React.ReactNode;
}) {
    return (
        <Card className="gap-0">
            <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">{title}</CardTitle>
                {subtitle ? (
                    <p className="text-xs text-muted-foreground">{subtitle}</p>
                ) : null}
            </CardHeader>
            <CardContent className="px-2 pb-2">
                {state.error ? (
                    <ErrorBlock message={state.error} onRetry={state.reload} />
                ) : state.loading && !state.hasData ? (
                    <div className="px-2">
                        <LoadingBlock rows={4} />
                    </div>
                ) : isEmpty ? (
                    <EmptyBlock message={emptyMessage} />
                ) : (
                    children
                )}
            </CardContent>
        </Card>
    );
}

/** "2026-09-03" -> "03/09". Truc X chi can ngay/thang, nam lam chat truc. */
function shortDay(day: string): string {
    const parts = day.split("-");
    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : day;
}

const TREND_CONFIG = {
    created: { label: "Đơn mới", color: "var(--chart-1)" },
    completed: { label: "Đơn xong", color: "var(--chart-2)" }
} satisfies ChartConfig;

export function OrderTrendChart({ state }: { state: Fetched<OrderTrend> }) {
    const trend = state.data;

    // Server tra hai mang RIENG (created, completed) va chi tra ngay CO du lieu. Gop bang
    // union cac ngay roi dien 0 — neu chi lay mang created lam truc thi ngay chi co don
    // xong se bien mat khoi bieu do.
    const byDay = new Map<string, { day: string; created: number; completed: number }>();
    const touch = (day: string) => {
        const existing = byDay.get(day);
        if (existing) return existing;
        const fresh = { day, created: 0, completed: 0 };
        byDay.set(day, fresh);
        return fresh;
    };
    for (const point of trend?.created ?? []) touch(point.day).created = point.count;
    for (const point of trend?.completed ?? []) touch(point.day).completed = point.count;
    const rows = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));

    return (
        <ChartCard
            title="Đơn theo ngày"
            subtitle={trend ? `${trend.days} ngày gần nhất` : undefined}
            state={{ ...state, hasData: Boolean(trend) }}
            isEmpty={rows.length === 0}
            emptyMessage="Chưa có đơn nào trong khoảng này"
        >
            <ChartContainer config={TREND_CONFIG} className="h-[220px] w-full">
                <AreaChart data={rows} margin={{ left: 4, right: 12, top: 8 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                        dataKey="day"
                        tickFormatter={shortDay}
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={24}
                    />
                    <YAxis
                        allowDecimals={false}
                        width={28}
                        tickLine={false}
                        axisLine={false}
                    />
                    <ChartTooltip
                        content={<ChartTooltipContent labelFormatter={value => shortDay(String(value))} />}
                    />
                    <Area
                        dataKey="created"
                        type="monotone"
                        stroke="var(--color-created)"
                        fill="var(--color-created)"
                        fillOpacity={0.15}
                        strokeWidth={2}
                    />
                    <Area
                        dataKey="completed"
                        type="monotone"
                        stroke="var(--color-completed)"
                        fill="var(--color-completed)"
                        fillOpacity={0.15}
                        strokeWidth={2}
                    />
                </AreaChart>
            </ChartContainer>
        </ChartCard>
    );
}

const BUDGET_CONFIG = {
    count: { label: "Số đơn", color: "var(--chart-1)" }
} satisfies ChartConfig;

export function BudgetChart({ state }: { state: Fetched<BudgetBucket[]> }) {
    const buckets = state.data ?? [];
    // Co du lieu nhung tat ca bucket = 0 van la "chua co du lieu" voi nguoi doc.
    const isEmpty = buckets.length === 0 || buckets.every(b => b.count === 0);

    return (
        <ChartCard
            title="Phân bố ngân sách"
            subtitle="Đơn có ghi số tiền"
            state={{ ...state, hasData: Boolean(state.data) }}
            isEmpty={isEmpty}
            emptyMessage="Chưa có đơn nào ghi ngân sách"
        >
            <ChartContainer config={BUDGET_CONFIG} className="h-[220px] w-full">
                <BarChart data={buckets} margin={{ left: 4, right: 12, top: 8 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        interval={0}
                        className="text-[10px]"
                    />
                    <YAxis allowDecimals={false} width={28} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
                </BarChart>
            </ChartContainer>
        </ChartCard>
    );
}
