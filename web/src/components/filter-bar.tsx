"use client";

import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";

// Thanh bo loc dung chung cho bon trang danh sach.
//
// Radix Select KHONG cho item co value chuoi rong, nen "tat ca" phai la mot gia tri that.
// Dung ALL_VALUE lam sentinel roi doi ve undefined truoc khi ra query string — de tang
// tren khong bao gio nhan `?status=`.
export const ALL_VALUE = "__all__";

export function FilterBar({ children }: { children: ReactNode }) {
    return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>;
}

export interface FilterOption {
    value: string;
    label: string;
}

export function FilterSelect({
    value,
    onChange,
    options,
    allLabel,
    width = "w-[170px]"
}: {
    /** undefined = khong loc. */
    value: string | undefined;
    onChange: (value: string | undefined) => void;
    options: FilterOption[];
    /**
     * Bo trong thi KHONG co lua chon "tat ca". Dung cho bo loc ma tang tren bat buoc phai
     * co gia tri — showcase la vi du: server luon loc dung mot trang thai.
     */
    allLabel?: string;
    width?: string;
}) {
    return (
        <Select
            value={value ?? ALL_VALUE}
            onValueChange={next => onChange(next === ALL_VALUE ? undefined : next)}
        >
            <SelectTrigger size="sm" className={width}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {allLabel ? <SelectItem value={ALL_VALUE}>{allLabel}</SelectItem> : null}
                {options.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                        {option.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

export function SearchInput({
    value,
    onChange,
    placeholder
}: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
}) {
    return (
        <div className="relative w-full sm:w-[260px]">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
                value={value}
                onChange={event => onChange(event.target.value)}
                placeholder={placeholder}
                className="h-8 pr-8 pl-8"
            />
            {value ? (
                <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-1/2 right-0.5 size-7 -translate-y-1/2"
                    onClick={() => onChange("")}
                    aria-label="Xoá tìm kiếm"
                >
                    <X className="size-3.5" />
                </Button>
            ) : null}
        </div>
    );
}
