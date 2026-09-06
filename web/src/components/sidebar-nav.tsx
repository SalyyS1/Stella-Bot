"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    Briefcase, Image as ImageIcon, LayoutDashboard, Ticket, Users, Wrench
} from "lucide-react";
import { cn } from "@/lib/utils";

// Sidebar cua panel. "use client" vi can usePathname de to muc dang mo.

const LINKS = [
    { href: "/", label: "Tổng quan", icon: LayoutDashboard },
    { href: "/orders/", label: "Đơn hàng", icon: Briefcase },
    { href: "/freelancers/", label: "Freelancer", icon: Wrench },
    { href: "/members/", label: "Thành viên", icon: Users },
    { href: "/tickets/", label: "Ticket", icon: Ticket },
    { href: "/showcases/", label: "Showcase", icon: ImageIcon }
] as const;

export function SidebarNav() {
    const pathname = usePathname();

    return (
        <aside className="flex h-svh w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
            <div className="flex items-center gap-2 px-5 py-5">
                <span className="text-lg font-semibold tracking-tight">Stella</span>
                <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">
                    panel
                </span>
            </div>
            <nav className="flex flex-1 flex-col gap-1 px-3">
                {LINKS.map(link => {
                    // Trang con (/orders/40/) van to muc cha "Đơn hàng".
                    const active = link.href === "/"
                        ? pathname === "/"
                        : pathname.startsWith(link.href.replace(/\/$/, ""));
                    const Icon = link.icon;
                    return (
                        <Link
                            key={link.href}
                            href={link.href}
                            className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                                active
                                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                            )}
                        >
                            <Icon className="size-4" />
                            {link.label}
                        </Link>
                    );
                })}
            </nav>
            <div className="px-5 py-4 text-xs text-muted-foreground">
                Chỉ đọc · dữ liệu mẫu
            </div>
        </aside>
    );
}
