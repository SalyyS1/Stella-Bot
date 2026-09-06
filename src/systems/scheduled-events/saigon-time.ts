import { config } from '../../config';

// Đổi "giờ tường" ở múi giờ của server (Asia/Ho_Chi_Minh) sang thời điểm UTC thật.
//
// Vì sao không dùng offset cứng +7: đúng hôm nay, nhưng một hàm parse mà hard-code
// offset là hẹn giờ nổ nếu múi giờ config đổi sang nơi có DST. Thuật toán một nhịp:
// đoán UTC = giờ tường, hỏi Intl xem giờ tường ở múi đó là mấy giờ, rồi bù đúng
// phần lệch. Việt Nam không có DST nên một nhịp luôn hội tụ.
const TIME_ZONE = config.maintenance.timezone;

function wallPartsInTZ(tz: string, date: Date): { year: number; month: number; day: number; hour: number; minute: number } {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(date);
    const get = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? 0);
    return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute') };
}

export function wallToUTC(tz: string, year: number, month: number, day: number, hour: number, minute: number): Date {
    const wallTarget = Date.UTC(year, month - 1, day, hour, minute);
    const guessedWallParts = wallPartsInTZ(tz, new Date(wallTarget));
    const guessedWall = Date.UTC(guessedWallParts.year, guessedWallParts.month - 1, guessedWallParts.day, guessedWallParts.hour, guessedWallParts.minute);
    return new Date(wallTarget + (wallTarget - guessedWall));
}

// Định dạng nhận: "HH:MM dd/mm" hoặc "HH:MM dd/mm/yyyy" — giờ trước, ngày sau, theo cách
// người Việt nói ("8 giờ tối 10/9"). Năm thiếu thì lấy năm hiện tại trong cùng múi giờ.
const START_PATTERN = /^(\d{1,2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/;

// null = không parse được; người gọi tự báo lỗi bằng lời.
export function parseEventStart(input: string, now = new Date()): Date | null {
    const match = START_PATTERN.exec(input.trim());
    if (!match) return null;

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const day = Number(match[3]);
    const month = Number(match[4]);
    const nowParts = wallPartsInTZ(TIME_ZONE, now);
    const year = match[5] ? Number(match[5]) : nowParts.year;

    if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;
    // Date.UTC tự cuộn ngày tràn (31/02 thành đầu tháng 3); so lại tháng để từ chối hẳn.
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCMonth() !== month - 1) return null;

    return wallToUTC(TIME_ZONE, year, month, day, hour, minute);
}
