import type { ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// Ba trang thai cua moi bang, tach ROI NHAU.
//
// "Khong co don nao" khac "khong tai duoc don" — tron hai cai lai la admin ngoi cho du
// lieu khong bao gio toi. Nen day la ba component rieng, va moi bang phai dung ca ba.

export function LoadingBlock({ rows = 5 }: { rows?: number }) {
    return (
        <div className="space-y-2 py-2">
            {Array.from({ length: rows }, (_unused, i) => (
                <Skeleton key={i} className="h-10 w-full" />
            ))}
        </div>
    );
}

export function EmptyBlock({ message, hint }: { message: string; hint?: ReactNode }) {
    return (
        <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
            <Inbox className="size-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">{message}</p>
            {hint ? <p className="max-w-md text-xs text-muted-foreground">{hint}</p> : null}
        </div>
    );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return (
        <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
            <AlertTriangle className="size-8 text-destructive" />
            <div>
                <p className="text-sm font-medium">Không tải được dữ liệu</p>
                <p className="mt-1 text-xs text-muted-foreground">{message}</p>
            </div>
            {onRetry ? (
                <Button variant="outline" size="sm" onClick={onRetry}>
                    Thử lại
                </Button>
            ) : null}
        </div>
    );
}
