import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Hai manh dung chung cua cac trang chi tiet: mot o "nhan + gia tri", va mot the nhom cac
// o do lai. Viet mot lan de trang don va trang thanh vien khong lech nhau ve khoang cach.

export function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-sm break-words">{children}</p>
        </div>
    );
}

export function DetailCard({
    title,
    columns = 2,
    className,
    children
}: {
    title: string;
    columns?: 2 | 3;
    className?: string;
    children: ReactNode;
}) {
    return (
        <Card className={className ? `gap-0 ${className}` : "gap-0"}>
            <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">{title}</CardTitle>
            </CardHeader>
            <CardContent
                className={columns === 3 ? "grid grid-cols-3 gap-3" : "grid grid-cols-2 gap-3"}
            >
                {children}
            </CardContent>
        </Card>
    );
}
