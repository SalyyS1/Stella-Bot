import { randomInt } from 'crypto';

export interface WeightedCandidate {
    userId: string;
    weight: number;
}

// Quay có trọng số, không hoàn lại: người trúng bị lấy khỏi rổ trước lượt kế tiếp.
//
// Tách riêng khỏi invite-giveaway-weight.ts để file này KHÔNG import prisma: thuật
// toán quay là thứ phải test được bằng 20k lượt chạy trong bộ nhớ, mà kéo theo
// Prisma thì test lại cần một database chỉ để nhân vài phép cộng.
//
// Trọng số <= 0 được kéo về 1 chứ không bị loại: một lỗi tính toán ở tầng trên không
// được phép âm thầm gạt ai đó khỏi giveaway mà không ai biết.
export function pickWinnersWeighted(candidates: WeightedCandidate[], count: number): string[] {
    const pool = candidates
        .filter((row, index, all) => all.findIndex(other => other.userId === row.userId) === index)
        .map(row => ({ userId: row.userId, weight: Math.max(1, Math.floor(row.weight)) }));

    const winners: string[] = [];
    while (pool.length && winners.length < count) {
        const total = pool.reduce((sum, row) => sum + row.weight, 0);
        let ticket = randomInt(total);
        let pickedIndex = pool.length - 1;
        for (let index = 0; index < pool.length; index++) {
            ticket -= pool[index].weight;
            if (ticket < 0) {
                pickedIndex = index;
                break;
            }
        }
        winners.push(pool.splice(pickedIndex, 1)[0].userId);
    }
    return winners;
}
