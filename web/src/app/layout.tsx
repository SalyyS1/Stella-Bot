import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SidebarNav } from "@/components/sidebar-nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  // Tieng Viet can subset "vietnamese" — thieu la moi ky tu co dau rot ve font he thong
  // va cau chu trong nhu tron hai font.
  subsets: ["latin", "vietnamese"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Stella — Panel quản trị",
  description: "Panel chỉ đọc cho quản trị Stella Studio",
  // Panel admin khong co viec gi tren Google.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="vi"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-svh">
        <SidebarNav />
        <main className="min-w-0 flex-1 overflow-y-auto px-8 py-6">{children}</main>
      </body>
    </html>
  );
}
