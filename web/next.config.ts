import type { NextConfig } from "next";

// Static export: `next build` cho ra HTML/CSS/JS thuan trong web/out, bot serve bang
// node:http. Host KHONG chay Next runtime, khong build gi — no da OOM khi chay tsc, va
// next build nang hon the. Mat SSR va API routes cua Next, nhung khong can: API nam o bot.
const nextConfig: NextConfig = {
  output: "export",
  // Repo có lockfile bot ở thư mục cha và lockfile web riêng. Chỉ rõ root để Turbopack
  // không coi toàn bộ bot là workspace frontend rồi scan/build thừa.
  turbopack: { root: process.cwd() },
  // Toi uu anh cua Next can server; static export thi phai tat.
  images: { unoptimized: true },
  // /orders/ -> web/out/orders/index.html, de static server cua bot giai duoc bang
  // "thu muc thi tim index.html" ma khong can bang route rieng.
  trailingSlash: true,
};

export default nextConfig;
