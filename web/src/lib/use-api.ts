"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";

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

export function useApi<T>(path: string, options: { refetchMs?: number } = {}): Fetched<T> {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [nonce, setNonce] = useState(0);
    const refetchMs = options.refetchMs ?? 0;

    useEffect(() => {
        let alive = true;

        // Path rong = "chua du dieu kien de goi" (vi du trang chi tiet chua co id trong
        // URL). Goi voi path rong la mot request chac chan sai, nen ngoi im: khong loading,
        // khong loi. Trang tu quyet dinh hien gi trong truong hop nay.
        if (!path) {
            setLoading(false);
            return () => { alive = false; };
        }

        const run = async () => {
            try {
                const result = await apiGet<T>(path);
                // Component da unmount (doi trang) thi khong setState — React se canh
                // bao, va quan trong hon la ket qua cu co the ghi de ket qua trang moi.
                if (!alive) return;
                setData(result);
                setError(null);
            } catch (err) {
                if (!alive) return;
                setError(err instanceof Error ? err.message : "Không tải được dữ liệu");
            } finally {
                if (alive) setLoading(false);
            }
        };

        setLoading(true);
        // Doi path (sang trang, doi bo loc) hoac bam "Thu lai" thi xoa loi cu: giu lai loi
        // cua truy van truoc va gan no vao truy van moi la bao sai cho.
        //
        // Chi xoa o day, KHONG xoa trong `run` — `run` con duoc goi lai moi 60s boi
        // setInterval, xoa trong do se lam loi nhay mat roi hien lai moi lan tick.
        setError(null);
        void run();

        // Chi dashboard dat refetchMs. Bang danh sach KHONG tu lam moi: dang doc ma bang
        // tu nhay la kho chiu.
        if (!refetchMs) return () => { alive = false; };
        const timer = setInterval(run, refetchMs);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [path, refetchMs, nonce]);

    return { data, error, loading, reload: () => setNonce(n => n + 1) };
}
