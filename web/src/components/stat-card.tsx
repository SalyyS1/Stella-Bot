import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// The so cho dashboard. `hint` la dong giai thich con so — chon theo tieu chi "con so nay
// lam Saly lam gi khac di", nen no phai noi duoc HANH DONG, khong chi don vi.
export function StatCard({
    label,
    value,
    hint,
    tone = "default",
    icon
}: {
    label: string;
    value: ReactNode;
    hint?: ReactNode;
    /** `warn` khi con so nay la viec can lam ngay (don qua han, ticket bi bo quen). */
    tone?: "default" | "warn" | "good";
    icon?: ReactNode;
}) {
    return (
        <Card className="gap-0 py-4">
            <CardContent className="px-4">
                <div className="flex items-start justify-between gap-2">
                    <span className="text-sm text-muted-foreground">{label}</span>
                    {icon ? <span className="text-muted-foreground">{icon}</span> : null}
                </div>
                <div
                    className={cn(
                        "mt-2 text-3xl font-semibold tabular-nums tracking-tight",
                        tone === "warn" && "text-destructive",
                        tone === "good" && "text-chart-2"
                    )}
                >
                    {value}
                </div>
                {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
            </CardContent>
        </Card>
    );
}
