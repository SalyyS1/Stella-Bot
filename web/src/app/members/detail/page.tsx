"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { DetailCard, Field } from "@/components/detail-field";
import { ErrorBlock, LoadingBlock } from "@/components/data-state";
import { useApi } from "@/lib/use-api";
import { formatDate, formatNumber, formatVoiceSeconds, timeAgo } from "@/lib/format";
import type { MemberDetail } from "@/lib/panel-types";

// Query string thay vi route dong, cung ly do nhu trang chi tiet don: static export
// khong the biet truoc danh sach ID luc build.

function MemberDetailBody() {
    const params = useSearchParams();
    const id = params.get("id");
    const state = useApi<MemberDetail>(id ? `/api/members/${id}` : "");
    const member = id ? state.data : null;

    const backButton = (
        <Button variant="outline" size="sm" asChild>
            <Link href="/members/">
                <ArrowLeft className="size-4" />
                Về danh sách
            </Link>
        </Button>
    );

    if (!id) {
        return (
            <>
                <PageHeader title="Chi tiết thành viên" actions={backButton} />
                <Card className="py-0">
                    <ErrorBlock message="Thiếu Discord ID trong đường dẫn (?id=...)." />
                </Card>
            </>
        );
    }

    if (state.error) {
        return (
            <>
                <PageHeader title="Chi tiết thành viên" actions={backButton} />
                <Card className="py-0">
                    <ErrorBlock message={state.error} onRetry={state.reload} />
                </Card>
            </>
        );
    }

    if (!member) {
        return (
            <>
                <PageHeader title="Chi tiết thành viên" actions={backButton} />
                <Card className="px-4 py-2">
                    <LoadingBlock rows={6} />
                </Card>
            </>
        );
    }

    return (
        <>
            <PageHeader
                title={`Level ${member.level}`}
                description={
                    <span className="flex flex-wrap items-center gap-2">
                        <code className="text-xs">{member.id}</code>
                        {member.verified ? (
                            <Badge variant="outline" className="border-chart-2/30 bg-chart-2/15 text-chart-2">
                                Đã xác minh
                            </Badge>
                        ) : null}
                        {member.hasPortfolio ? (
                            <Badge variant="outline">Có portfolio</Badge>
                        ) : null}
                        {member.blacklisted ? (
                            <Badge variant="outline" className="border-destructive/40 bg-destructive/15 text-destructive">
                                Trong danh sách chặn
                            </Badge>
                        ) : null}
                    </span>
                }
                actions={backButton}
            />

            <div className="grid gap-3 lg:grid-cols-2">
                <DetailCard title="Hoạt động">
                    <Field label="Level">{`${member.level} · ${formatNumber(member.xp)} xp`}</Field>
                    <Field label="Tin nhắn">{formatNumber(member.totalMessages)}</Field>
                    <Field label="Thời gian voice">{formatVoiceSeconds(member.voiceSeconds)}</Field>
                    <Field label="Chuỗi ngày điểm danh">{`${formatNumber(member.dailyStreak)} ngày`}</Field>
                    <Field label="Vào server">
                        {member.joinedAt
                            ? `${formatDate(member.joinedAt)} (${timeAgo(member.joinedAt)})`
                            : "Không rõ"}
                    </Field>
                </DetailCard>

                <DetailCard title="Scoin">
                    <Field label="Đang giữ">{formatNumber(member.scoinBalance)}</Field>
                    <Field label="Đã kiếm tổng">{formatNumber(member.scoinEarnedTotal)}</Field>
                </DetailCard>

                <DetailCard title="Đóng góp">
                    <Field label="Điểm đóng góp">{formatNumber(member.contributionScore)}</Field>
                    <Field label="Điểm chuyên môn">{formatNumber(member.expertScore)}</Field>
                </DetailCard>

                <DetailCard title="Đơn hàng">
                    <Field label="Đã đăng">{formatNumber(member.ordersRequested)}</Field>
                    <Field label="Đã nhận">{formatNumber(member.ordersClaimed)}</Field>
                </DetailCard>

                <DetailCard title="Mời người">
                    <Field label="Mời thành công">{formatNumber(member.inviteTotal)}</Field>
                    <Field label="Đang chờ xác minh">{formatNumber(member.invitePending)}</Field>
                </DetailCard>

                <DetailCard title="Kỷ luật">
                    <Field label="Cảnh báo còn hiệu lực">
                        <span className={member.activeWarns > 0 ? "font-medium text-destructive" : undefined}>
                            {formatNumber(member.activeWarns)}
                        </span>
                    </Field>
                    <Field label="Tổng số vụ đã xử">{formatNumber(member.modCaseTotal)}</Field>
                </DetailCard>
            </div>
        </>
    );
}

export default function MemberDetailPage() {
    return (
        <Suspense
            fallback={
                <Card className="px-4 py-2">
                    <LoadingBlock rows={6} />
                </Card>
            }
        >
            <MemberDetailBody />
        </Suspense>
    );
}
