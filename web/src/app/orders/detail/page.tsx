"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, OrderStatusBadge } from "@/components/page-header";
import { Field } from "@/components/detail-field";
import { ErrorBlock, LoadingBlock } from "@/components/data-state";
import { useApi } from "@/lib/use-api";
import { formatDate, timeAgo } from "@/lib/format";
import { kindLabel, skillLabel } from "@/lib/panel-labels";
import { safeHttpUrl } from "@/lib/url-safety";
import type { OrderDetail } from "@/lib/panel-types";

// Trang chi tiet dung QUERY STRING (`/orders/detail/?id=41`) chu khong phai route dong
// (`/orders/[id]`). Ly do: panel la static export (`output: 'export'`), ma route dong khi
// export doi `generateStaticParams` — tuc la phai biet truoc toan bo ID luc build. ID don
// sinh ra lien tuc sau khi build, nen route dong se 404 voi moi don moi.

function Stars({ rating }: { rating: number }) {
    return (
        <span className="inline-flex items-center gap-0.5 align-middle">
            {Array.from({ length: 5 }, (_unused, i) => (
                <Star
                    key={i}
                    className={
                        i < rating
                            ? "size-3.5 fill-chart-4 text-chart-4"
                            : "size-3.5 text-muted-foreground/40"
                    }
                />
            ))}
        </span>
    );
}

function OrderDetailBody() {
    const params = useSearchParams();
    const id = params.get("id");

    // Path chi duoc dung khi co id. Khong co id thi khong goi API — goi `/api/orders/`
    // la mot request chac chan sai.
    const state = useApi<OrderDetail>(id ? `/api/orders/${id}` : "");
    const order = id ? state.data : null;

    const backButton = (
        <Button variant="outline" size="sm" asChild>
            <Link href="/orders/">
                <ArrowLeft className="size-4" />
                Về danh sách
            </Link>
        </Button>
    );

    if (!id) {
        return (
            <>
                <PageHeader title="Chi tiết đơn" actions={backButton} />
                <Card className="py-0">
                    <ErrorBlock message="Thiếu mã đơn trong đường dẫn (?id=...)." />
                </Card>
            </>
        );
    }

    if (state.error) {
        return (
            <>
                <PageHeader title={`Đơn #${id}`} actions={backButton} />
                <Card className="py-0">
                    <ErrorBlock message={state.error} onRetry={state.reload} />
                </Card>
            </>
        );
    }

    if (!order) {
        return (
            <>
                <PageHeader title={`Đơn #${id}`} actions={backButton} />
                <Card className="px-4 py-2">
                    <LoadingBlock rows={6} />
                </Card>
            </>
        );
    }

    return (
        <>
            <PageHeader
                title={`Đơn #${order.id}`}
                description={order.service}
                actions={backButton}
            />

            <div className="grid gap-3 lg:grid-cols-3">
                <Card className="gap-0 lg:col-span-2">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base font-medium">Nội dung</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <p className="text-xs text-muted-foreground">Mô tả</p>
                            <p className="mt-1 text-sm whitespace-pre-wrap">{order.description}</p>
                        </div>
                        {order.other ? (
                            <div>
                                <p className="text-xs text-muted-foreground">Ghi chú khác</p>
                                <p className="mt-1 text-sm whitespace-pre-wrap">{order.other}</p>
                            </div>
                        ) : null}
                        <div>
                            <p className="text-xs text-muted-foreground">
                                Ảnh tham chiếu ({order.referenceUrls.length})
                            </p>
                            {order.referenceUrls.length === 0 ? (
                                <p className="mt-1 text-sm text-muted-foreground">Không có</p>
                            ) : (
                                // Mo bang LINK chu khong nhung <img>: nhung anh nghia la moi lan
                                // admin mo trang nay la mot request tu may admin ra CDN Discord.
                                // URL nay do nguoi dat don gõ vao, nen phai qua safeHttpUrl —
                                // React escape noi dung nhung KHONG kiem scheme cua href.
                                <ul className="mt-1 space-y-1">
                                    {order.referenceUrls.map((raw, index) => {
                                        const href = safeHttpUrl(raw);
                                        if (!href) {
                                            return (
                                                <li key={raw} className="text-sm text-muted-foreground">
                                                    Ảnh {index + 1}: link không hợp lệ
                                                </li>
                                            );
                                        }
                                        return (
                                            <li key={raw}>
                                                <a
                                                    href={href}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                                                >
                                                    Ảnh {index + 1}
                                                    <ExternalLink className="size-3" />
                                                </a>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card className="gap-0">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base font-medium">Thông tin</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-3">
                        <Field label="Trạng thái">
                            <OrderStatusBadge status={order.status} />
                        </Field>
                        <Field label="Loại">{kindLabel(order.kind)}</Field>
                        <Field label="Kỹ năng">{skillLabel(order.skill)}</Field>
                        <Field label="Ngân sách">{order.budgetLabel}</Field>
                        <Field label="Hạn">{formatDate(order.dueDate)}</Field>
                        <Field label="Kênh riêng">{order.hasOrderChannel ? "Có" : "Không"}</Field>
                        <Field label="Người đăng">
                            <code className="text-xs">{order.requesterId}</code>
                        </Field>
                        <Field label="Người nhận">
                            {order.claimedById ? (
                                <code className="text-xs">{order.claimedById}</code>
                            ) : (
                                "Chưa ai nhận"
                            )}
                        </Field>
                        <Field label="Tạo">{`${formatDate(order.createdAt)} (${timeAgo(order.createdAt)})`}</Field>
                        <Field label="Cập nhật">{timeAgo(order.updatedAt)}</Field>
                        <Field label="Hoàn thành">{formatDate(order.completedAt)}</Field>
                        <Field label="Đóng">{formatDate(order.closedAt)}</Field>
                    </CardContent>
                </Card>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <Card className="gap-0">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base font-medium">
                            Lượt nhận ({order.claims.length})
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {order.claims.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Chưa có ai nhận đơn này.</p>
                        ) : (
                            <ul className="space-y-2">
                                {order.claims.map(claim => (
                                    <li
                                        key={`${claim.claimerId}-${claim.createdAt}`}
                                        className="flex items-center justify-between gap-2 text-sm"
                                    >
                                        <code className="text-xs">{claim.claimerId}</code>
                                        <span className="flex items-center gap-2">
                                            <Badge variant="outline" className="font-normal">
                                                {claim.status}
                                            </Badge>
                                            <span className="text-xs text-muted-foreground">
                                                {timeAgo(claim.createdAt)}
                                            </span>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>

                <Card className="gap-0">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base font-medium">
                            Đánh giá ({order.reviews.length})
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {order.reviews.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Chưa có đánh giá.</p>
                        ) : (
                            <ul className="space-y-3">
                                {order.reviews.map(review => (
                                    <li key={`${review.reviewerId}-${review.createdAt}`}>
                                        <div className="flex items-center justify-between gap-2">
                                            <Stars rating={review.rating} />
                                            <span className="text-xs text-muted-foreground">
                                                {timeAgo(review.createdAt)}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            <code>{review.reviewerId}</code> đánh giá{" "}
                                            <code>{review.targetId}</code>
                                        </p>
                                        {review.note ? (
                                            <p className="mt-1 text-sm whitespace-pre-wrap">{review.note}</p>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>
            </div>
        </>
    );
}

export default function OrderDetailPage() {
    // `useSearchParams` bat buoc phai nam trong Suspense khi build static — khong co thi
    // `next build` bao loi "missing suspense boundary with useSearchParams".
    return (
        <Suspense
            fallback={
                <Card className="px-4 py-2">
                    <LoadingBlock rows={6} />
                </Card>
            }
        >
            <OrderDetailBody />
        </Suspense>
    );
}
