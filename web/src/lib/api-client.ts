// Loi goi API duy nhat cua panel. Moi trang di qua day, khong trang nao tu fetch.
//
// Base URL rong (cung origin voi bot) la co y: khong co bien moi truong client nao o
// day, vi moi thu trong bundle static la thu nguoi la doc duoc. Panel duoc serve boi
// chinh process bot nen cung origin luon dung.
//
// MOCK MODE: chua co cong admin (phase 2) nen /api/* con 404. Khi USE_MOCK bat, moi
// duong dan tra du lieu mau tu mock-data.ts — dung DUNG kieu tra ve cua
// src/panel/data/* ben bot, de luc thay bang API that thi chi xoa co nay.
import { mockResponse } from "./mock-data";

const USE_MOCK = true;

export class ApiError extends Error {
    constructor(
        public readonly status: number,
        message: string
    ) {
        super(message);
    }
}

export async function apiGet<T>(path: string): Promise<T> {
    if (USE_MOCK) {
        // Tre gia lap nho de skeleton hien ra nhu that; khong co la moi trang
        // "nhay" tuc thi va khong ai nhan ra thieu trang thai loading.
        await new Promise(resolve => setTimeout(resolve, 250));
        const result = mockResponse(path);
        // Mock tra null cho ban ghi khong ton tai. Bien thanh 404 y nhu server that,
        // de trang chi tiet duoc thu voi ca truong hop "khong tim thay".
        if (result === null) throw new ApiError(404, "Không tìm thấy dữ liệu");
        return result as T;
    }

    const res = await fetch(path, {
        // Cookie session cua cong admin. Panel cung origin nen day chi la noi ro,
        // nhung de tuong minh van hon.
        credentials: "include",
        headers: { Accept: "application/json" }
    });

    if (res.status === 401) {
        // Xu ly dang nhap o MOT cho. Tung trang khong tu xu 401.
        if (typeof window !== "undefined") window.location.href = "/auth/login";
        throw new ApiError(401, "Chưa đăng nhập");
    }
    if (!res.ok) {
        throw new ApiError(res.status, `API trả về ${res.status}`);
    }
    return res.json() as Promise<T>;
}
