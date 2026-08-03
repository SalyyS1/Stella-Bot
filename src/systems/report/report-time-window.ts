import { config } from '../../config';

// Saigon wall-clock helpers for the nhật báo. The day is cut into fixed 3h slots
// (24 / slotHours = 8 per day) and a slot is identified by the ABSOLUTE hour it
// starts at, never by "how many times have we run today". A restart or a missed
// tick therefore costs exactly the one slot it happened in, instead of shifting
// every later slot's identity and letting the same window be summarized twice.

export interface SaigonSlot {
    period: string; // Saigon calendar day, YYYY-MM-DD
    slot: number;   // 0..(24/slotHours - 1)
    startMs: number;
    endMs: number;
}

interface Parts {
    period: string;
    hour: number;
    minute: number;
    second: number;
}

// hourCycle 'h23' is requested explicitly rather than hour12:false: some ICU
// builds render midnight as hour "24" under hour12:false, which would push the
// slot index out of range and (worse) disagree with the date field about which
// day it is. h23 is guaranteed 0-23. The % 24 below is a cheap belt-and-braces.
function saigonParts(at: Date): Parts {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: config.maintenance.timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(at);
    const get = (type: string) => parts.find(p => p.type === type)?.value || '0';
    return {
        period: `${get('year')}-${get('month')}-${get('day')}`,
        hour: Number(get('hour')) % 24,
        minute: Number(get('minute')),
        second: Number(get('second'))
    };
}

export function saigonNow(): { hour: number; period: string } {
    const { hour, period } = saigonParts(new Date());
    return { hour, period };
}

export function slotsPerDay(): number {
    return Math.max(1, Math.floor(24 / config.report.chunk.slotHours));
}

// Lần kế tiếp đồng hồ Saigon chỉ đúng hour:minute, trả về epoch ms.
//
// Dùng cho hệ nhắc nhở: người ta nói "3h chiều" theo giờ Hà Nội, còn host có thể
// chạy ở UTC. Cách tính bám đúng lối của slotAt() — lấy giờ tường Saigon HIỆN TẠI
// rồi cộng phần còn thiếu, KHÔNG hardcode +07:00 ở đâu. Viết kiểu
// `new Date('...+07:00')` sẽ đúng hôm nay và sai lặng lẽ nếu vùng đổi offset.
//
// Mốc đã qua trong ngày thì nhảy sang mai: "nhắc tôi 3h chiều" gõ lúc 4h chiều chỉ
// có thể nghĩa là 3h chiều mai. Cộng 86400s là đủ đúng vì Việt Nam không có DST;
// ở vùng có DST thì phép này lệch 1 tiếng hai lần mỗi năm.
export function nextSaigonTime(hour: number, minute: number, nowMs = Date.now()): number {
    const at = new Date(nowMs);
    const parts = saigonParts(at);
    const nowSec = parts.hour * 3600 + parts.minute * 60 + parts.second;
    const targetSec = hour * 3600 + minute * 60;
    let deltaSec = targetSec - nowSec;
    if (deltaSec <= 0) deltaSec += 86_400;
    // Trừ phần millisecond để mốc rơi đúng đầu giây, không lệch lẻ.
    return nowMs + deltaSec * 1000 - at.getMilliseconds();
}

// Mô tả một mốc epoch bằng giờ tường Saigon, để nói lại cho người dùng nghe.
//
// Cần vì mọi mốc trong hệ nhắc nhở được lưu dạng UTC: xác nhận lại bằng giờ UTC
// thì người đặt "3h chiều" sẽ đọc thấy "8:00" và tưởng bot hiểu sai, rồi đặt lại
// lần nữa. Nói lại đúng giờ họ đã nói là cách duy nhất để họ tin là đã đặt đúng.
export function describeSaigon(atMs: number): string {
    const { period, hour, minute } = saigonParts(new Date(atMs));
    const hh = String(hour).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    return `${hh}:${mm} ngày ${period} (giờ VN)`;
}

// Describe the slot containing `atMs`. The window bounds are derived by
// subtracting the elapsed wall-clock time since the slot began, NOT by assuming
// a fixed UTC offset — so the math holds regardless of the zone's offset or any
// future DST change, without hardcoding +07:00 anywhere.
export function slotAt(atMs: number): SaigonSlot {
    const at = new Date(atMs);
    const { period, hour, minute, second } = saigonParts(at);
    const slotHours = config.report.chunk.slotHours;
    const slot = Math.floor(hour / slotHours);
    const intoSlotMs =
        ((hour % slotHours) * 3600 + minute * 60 + second) * 1000 + at.getMilliseconds();
    const startMs = atMs - intoSlotMs;
    return { period, slot, startMs, endMs: startMs + slotHours * 3600_000 };
}

// The most recent slot that has fully elapsed. Summarizing only closed windows
// keeps a chunk from capturing half a slot and then being treated as complete.
export function lastClosedSlot(nowMs = Date.now()): SaigonSlot {
    const current = slotAt(nowMs);
    // Step back into the previous window by a whole slot; midpoint would do just
    // as well. -1ms lands on the last instant of the previous slot.
    return slotAt(current.startMs - 1);
}

// The 8 slots that make up the 24h ending at today's report time: yesterday's
// final slot plus today's slots up to (but excluding) the current one. This is
// deliberately the same 24h window the pre-map-reduce report covered, so moving
// to chunks changes the fidelity of the report, not the period it describes.
export function slotsForDailyReport(nowMs = Date.now()): Array<{ period: string; slot: number }> {
    return closedSlotsForDailyReport(nowMs).map(s => ({ period: s.period, slot: s.slot }));
}

// The same 8 windows, but carrying their full time bounds. The backfill needs the
// ms range to re-read chat for a window it missed, which the {period, slot} pair
// alone cannot give it.
export function closedSlotsForDailyReport(nowMs = Date.now()): SaigonSlot[] {
    const current = slotAt(nowMs);
    const perDay = slotsPerDay();
    const slots: SaigonSlot[] = [];
    for (let i = perDay; i >= 1; i--) {
        slots.push(slotAt(current.startMs - i * config.report.chunk.slotHours * 3600_000));
    }
    return slots;
}

// Chunk rows are claimed through MaintenanceLog, whose uniqueness is
// [channelId, kind, period] — so the slot has to be folded into the period
// string to get one lock per slot rather than one per day.
export function chunkLockPeriod(period: string, slot: number): string {
    return `${period}#${slot}`;
}

// Saigon day `days` before now, used as the prune cutoff. period strings are
// zero-padded YYYY-MM-DD, so lexicographic `<` is a correct date comparison.
export function periodDaysAgo(days: number, nowMs = Date.now()): string {
    return saigonParts(new Date(nowMs - days * 86_400_000)).period;
}

// Ngày Saigon cách basePeriod một số ngày (âm = về trước, dương = ra sau).
// Dùng cho bài tổng hợp tuần: từ khoá tuần (thứ Hai) sinh đủ 7 period T2→CN.
// Saigon = UTC+7 cố định (không DST) nên trừ 7h để mốc "bắt đầu ngày" rơi đúng
// ranh giới ngày Saigon, khớp với cách period được gán trong toàn hệ.
export function periodOffset(basePeriod: string, offsetDays: number): string {
    const [y, m, d] = basePeriod.split('-').map(Number);
    if (!y || !m || !d) return basePeriod;
    const startUtc = Date.UTC(y, m - 1, d) - 7 * 3600_000 + offsetDays * 86_400_000;
    return saigonParts(new Date(startUtc)).period;
}
