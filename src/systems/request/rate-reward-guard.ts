import { Prisma } from '@prisma/client';

type PrismaTx = Prisma.TransactionClient;

// Chốt chống farm điểm đánh giá.
//
// Lỗ ban đầu: đánh giá 5 sao trả cho người nhận `rating * 10` scoin, không giới hạn. Tự
// nhận đơn của mình đã bị chặn (`request.ownClaim`), nên farm cần hai tài khoản — nhưng hai
// tài khoản là chuyện mười phút: A đăng đơn, B nhận, A bấm xong, A đánh giá 5 sao, B nhận 50
// scoin. Lặp lại là in tiền.
//
// Hai luật dưới đây cùng một khái niệm — "đánh giá CÓ TRẢ THƯỞNG" — nên dễ giải thích và dễ
// kiểm. Cả hai đếm từ dữ liệu đã có (`RequestReview`, `ScoinTransaction`), không thêm bảng,
// không migration.

/** Số đánh giá có trả thưởng tối đa cho MỘT cặp (người đăng → người nhận) trong 30 ngày. */
export const RATE_PAIR_LIMIT = 3;

/** Cửa sổ tính luật cặp, tính theo ngày. */
export const RATE_PAIR_WINDOW_DAYS = 30;

/** Số đánh giá có trả thưởng tối đa mà MỘT người nhận được trả trong một ngày. */
export const RATE_DAILY_LIMIT = 3;

/** Scoin cho mỗi sao. Giữ nguyên hành vi cũ: 5 sao = 50 scoin. */
export const RATE_SCOIN_PER_STAR = 10;

export type RateSuppressReason = 'pair_limit' | 'daily_limit';

export interface RateRewardDecision {
    /** Scoin trả cho người nhận đơn. 0 nghĩa là bị chặn. */
    scoin: number;
    /** Điểm đóng góp cộng cho người nhận đơn. Đi cùng scoin, không tách. */
    contribution: number;
    /** null = trả thưởng bình thường. */
    suppressed: { reason: RateSuppressReason; detail: string } | null;
}

/** Nửa đêm hôm nay theo giờ máy (host chạy Asia/Saigon), giống `startOfToday` bên trivia. */
function startOfToday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Quyết định phần thưởng cho một lượt đánh giá — gọi TRONG transaction của `rateRequest`,
 * và gọi TRƯỚC khi ghi `RequestReview`, để số đếm không tính chính lượt đang xử lý.
 *
 * Bị chặn thì đánh giá vẫn được ghi (điểm sao vẫn tính vào uy tín); chỉ phần trả thưởng bị
 * bỏ. Người đánh giá KHÔNG được thông báo chuyện này — nói ra là chỉ cho người farm biết
 * ngưỡng ở đâu. Thay vào đó `rateRequest` ghi một dòng vào admin log.
 */
export async function decideRateReward(
    tx: PrismaTx,
    params: { requesterId: string; claimerId: string; rating: number }
): Promise<RateRewardDecision> {
    const full: RateRewardDecision = {
        scoin: params.rating * RATE_SCOIN_PER_STAR,
        contribution: params.rating,
        suppressed: null
    };
    const blocked = (reason: RateSuppressReason, detail: string): RateRewardDecision => ({
        scoin: 0,
        contribution: 0,
        suppressed: { reason, detail }
    });

    // Luật cặp: khách quay lại là chuyện thật và phải được trả thưởng, nên đếm theo cặp có
    // cửa sổ thời gian chứ không cấm hẳn. Cặp alt farm sẽ đụng trần ngay ở đơn thứ tư.
    const windowStart = new Date(Date.now() - RATE_PAIR_WINDOW_DAYS * 86_400_000);
    const pairPaid = await tx.requestReview.count({
        where: {
            reviewerId: params.requesterId,
            targetId: params.claimerId,
            createdAt: { gte: windowStart }
        }
    });
    if (pairPaid >= RATE_PAIR_LIMIT) {
        return blocked(
            'pair_limit',
            `${pairPaid} đánh giá cùng cặp trong ${RATE_PAIR_WINDOW_DAYS} ngày (trần ${RATE_PAIR_LIMIT})`
        );
    }

    // Luật ngày: chặn cả trường hợp dùng NHIỀU tài khoản alt khác nhau, vì mỗi cặp khi đó
    // đều dưới trần cặp. Đếm giao dịch đã trả (lượt bị chặn không ghi giao dịch nào) nên số
    // này đúng nghĩa "hôm nay đã được trả bao nhiêu lượt".
    const paidToday = await tx.scoinTransaction.count({
        where: {
            userId: params.claimerId,
            source: 'request:rate',
            createdAt: { gte: startOfToday() }
        }
    });
    if (paidToday >= RATE_DAILY_LIMIT) {
        return blocked('daily_limit', `đã được trả ${paidToday} lượt hôm nay (trần ${RATE_DAILY_LIMIT})`);
    }

    return full;
}
