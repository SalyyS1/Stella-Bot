"use client";

import { useState } from "react";
import { useApi, type Fetched } from "@/lib/use-api";
import type { Page } from "@/lib/panel-types";

// Mot hook cho ca bon trang danh sach: giu so trang, dung bo loc thanh query string, va
// tra ve dung `Fetched<Page<T>>` ma DataTable can.
//
// Ten tham so lay tu hop dong that ben src/panel/data/* (status/kind/skill, q, open,
// openOnly, authorId, page, pageSize). Doi ten o day la doi vao khoang khong.

export interface ListQuery<T> {
    state: Fetched<Page<T>>;
    goToPage: (page: number) => void;
}

export function useListQuery<T>(
    basePath: string,
    filters: Record<string, string | undefined> = {}
): ListQuery<T> {
    const search = new URLSearchParams();
    // Bo loc rong thi KHONG gui tham so, khong gui chuoi rong: `?status=` va khong co
    // `status` la hai thu khac nhau voi server.
    for (const [key, value] of Object.entries(filters)) {
        if (value) search.set(key, value);
    }
    const filterKey = search.toString();

    const [page, setPage] = useState(1);
    const [lastFilterKey, setLastFilterKey] = useState(filterKey);

    // Doi bo loc phai ve trang 1: dang o trang 3, loc lai con 5 dong, thi trang 3 rong —
    // admin thay bang trong va tuong khong co du lieu.
    //
    // Dat lai state NGAY TRONG render (khong phai useEffect) de React bo ket qua render
    // nay va render lai truoc khi chay effect — nen khong co lan fetch nao bang so trang cu.
    if (lastFilterKey !== filterKey) {
        setLastFilterKey(filterKey);
        setPage(1);
    }
    const effectivePage = lastFilterKey === filterKey ? page : 1;

    search.set("page", String(effectivePage));
    const state = useApi<Page<T>>(`${basePath}?${search.toString()}`);

    return {
        state,
        goToPage: next => setPage(Math.max(1, Math.floor(next)))
    };
}
