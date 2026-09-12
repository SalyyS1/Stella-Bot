"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet } from "@/lib/api-client";

// Mot hook cho moi trang. Ba trang thai tach ROI NHAU co y: "khong co du lieu" khac
// "khong tai duoc". Tron hai cai lai la admin ngoi cho mot bang trong ma khong biet la
// bang that trong hay request that bai.
export interface Fetched<T> {
    data: T | null;
    error: string | null;
    loading: boolean;
    /** Tang de fetch lai (nut "Thu lai" o trang thai loi). */
    reload: () => void;
}

interface FetchSnapshot<T> {
    key: string;
    data: T | null;
    error: string | null;
}

export function useApi<T>(path: string, options: { refetchMs?: number } = {}): Fetched<T> {
    const router = useRouter();
    const [nonce, setNonce] = useState(0);
    const [snapshot, setSnapshot] = useState<FetchSnapshot<T>>({
        key: "",
        data: null,
        error: null
    });
    const refetchMs = options.refetchMs ?? 0;
    const requestKey = path ? `${path}\u0000${nonce}` : "";

    useEffect(() => {
        let alive = true;

        // Path rong = "chua du dieu kien de goi" (vi du trang chi tiet chua co id trong
        // URL). Goi voi path rong la mot request chac chan sai, nen ngoi im: khong loading,
        // khong loi. Trang tu quyet dinh hien gi trong truong hop nay.
        if (!path) {
            return () => { alive = false; };
        }

        const run = async () => {
            try {
                const result = await apiGet<T>(path);
                // Component da unmount (doi trang) thi khong setState — React se canh
                // bao, va quan trong hon la ket qua cu co the ghi de ket qua trang moi.
                if (!alive) return;
                setSnapshot({ key: requestKey, data: result, error: null });
            } catch (err) {
                if (!alive) return;
                if (err instanceof ApiError && err.status === 401) {
                    router.replace("/auth/login");
                }
                setSnapshot(previous => ({
                    key: requestKey,
                    data: previous.key === requestKey ? previous.data : null,
                    error: err instanceof Error ? err.message : "Không tải được dữ liệu"
                }));
            }
        };

        // Loading/error khi đổi path được SUY RA từ requestKey ở dưới, không setState đồng
        // bộ trong effect. Cách này tránh một render dây chuyền và không cho dữ liệu của
        // path cũ lóe lên trong lúc request mới đang chạy.
        void run();

        // Chi dashboard dat refetchMs. Bang danh sach KHONG tu lam moi: dang doc ma bang
        // tu nhay la kho chiu.
        if (!refetchMs) return () => { alive = false; };
        const timer = setInterval(run, refetchMs);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [path, refetchMs, nonce, requestKey, router]);

    const current = Boolean(path) && snapshot.key === requestKey;
    return {
        data: current ? snapshot.data : null,
        error: current ? snapshot.error : null,
        loading: Boolean(path) && !current,
        reload: () => setNonce(n => n + 1)
    };
}
