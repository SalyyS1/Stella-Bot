// Luật automod thuần nội dung — KHÔNG biết tới discord.js.
//
// Vì sao tách ra: những luật này là chỗ dễ chặn oan nhất (VIẾT HOA, từ khoá, zalgo với
// tiếng Việt có dấu), mà chặn oan một lần là member mất niềm tin vào cả hệ thống. Tách
// thành hàm thuần thì test được bằng chuỗi ký tự, không cần dựng cả một Message giả.
//
// Trạng thái theo người (flood, trùng lặp) nằm ở automod-flood-tracker.ts.

export type ContentRuleKey =
    | 'massMention'
    | 'caps'
    | 'inviteLink'
    | 'links'
    | 'scamLink'
    | 'emojiSpam'
    | 'newlineSpam'
    | 'bannedWords'
    | 'zalgo';

export interface RuleHit {
    rule: ContentRuleKey;
    /** Câu giải thích ngắn để đưa vào log — mod phải hiểu ngay vì sao tin bị xoá. */
    detail: string;
}

export interface ContentFacts {
    content: string;
    /** Số người + role bị ping trong tin (lấy từ message.mentions, không đếm lại bằng regex). */
    mentionCount: number;
}

/** Tham số một luật, đọc từ config.automod.defaults rồi bị AutomodSetting.rules ghi đè. */
export interface RuleParams {
    enabled?: boolean;
    [key: string]: any;
}

export type RuleTable = Partial<Record<ContentRuleKey, RuleParams>>;

const INVITE_PATTERN = /(?:discord\.(?:gg|io|li|me)|discord(?:app)?\.com\/invite)\/[a-z0-9-]{2,}/i;
const URL_PATTERN = /https?:\/\/([^\s/?#]+)/gi;
const CUSTOM_EMOJI_PATTERN = /<a?:\w{2,32}:\d{15,25}>/g;
const UNICODE_EMOJI_PATTERN = /\p{Extended_Pictographic}/gu;

// Tên miền hay bị mạo danh. Điều kiện "chứa từ khoá nhưng không thuộc danh sách thật"
// bắt được cả những biến thể chưa ai từng thấy (dlscord.gift, steamcommunlty.ru...) —
// một blocklist thuần thì luôn chạy sau kẻ lừa đảo một bước.
const IMPERSONATED_KEYWORDS = /discord|discrod|dlscord|steam|nitro/i;
const OFFICIAL_HOST_SUFFIXES = [
    'discord.com',
    'discord.gg',
    'discord.media',
    'discord.dev',
    'discordapp.com',
    'discordapp.net',
    'discordstatus.com',
    // Cộng đồng dev/Minecraft dán mấy link này thường xuyên — thiếu chúng thì automod
    // chặn đúng những người đang giúp nhau viết plugin.
    'discord.js.org',
    'discordjs.guide',
    'steamcommunity.com',
    'steampowered.com',
    'steamstatic.com'
];

function hostOf(raw: string): string {
    return raw.toLowerCase().replace(/^www\./, '');
}

function isOfficialHost(host: string, extraSafe: string[]): boolean {
    const safe = [...OFFICIAL_HOST_SUFFIXES, ...extraSafe.map(hostOf)];
    return safe.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
}

function extractHosts(content: string): string[] {
    const hosts: string[] = [];
    for (const match of content.matchAll(URL_PATTERN)) {
        // Bỏ cả cổng và thông tin đăng nhập trong URL (user:pass@host:port).
        const host = hostOf(match[1].split('@').pop()!.split(':')[0]);
        if (host) hosts.push(host);
    }
    return hosts;
}

/** Đếm chữ hoa trên tổng số CHỮ CÁI, không tính số và dấu câu. */
function capsRatio(content: string): { ratio: number; letters: number } {
    const letters = content.match(/\p{L}/gu) || [];
    if (!letters.length) return { ratio: 0, letters: 0 };
    const upper = letters.filter(ch => ch !== ch.toLowerCase() && ch === ch.toUpperCase()).length;
    return { ratio: upper / letters.length, letters: letters.length };
}

// Zalgo = xếp hàng chục dấu phụ lên một ký tự để phá layout kênh.
//
// Bẫy ở đây là tiếng Việt: "ế" ở dạng NFD chính là e + hai dấu phụ, nên đếm thẳng dấu
// phụ trên chuỗi thô sẽ coi mọi câu tiếng Việt gõ bằng một số bộ IME là zalgo. Chuẩn
// hoá về NFC trước khi đếm là chỗ sửa đúng: sau NFC tiếng Việt gần như không còn dấu
// phụ rời, còn zalgo thì vẫn còn nguyên vì không có ký tự dựng sẵn cho nó.
function zalgoScore(content: string): { marks: number; base: number } {
    const normalized = content.normalize('NFC');
    const marks = (normalized.match(/\p{M}/gu) || []).length;
    const base = (normalized.match(/\P{M}/gu) || []).length;
    return { marks, base };
}

function bannedWordHit(content: string, words: string[]): string | null {
    const haystack = content.toLowerCase();
    for (const raw of words) {
        const word = raw.trim().toLowerCase();
        if (!word) continue;
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Khớp theo ranh giới từ tự dựng thay vì \b: \b coi ký tự có dấu là ranh giới,
        // nên cấm "cấm" sẽ khớp cả trong từ khác. Chặn oan vì lý do kỹ thuật là kiểu
        // sai khó giải thích nhất cho member.
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u');
        if (pattern.test(haystack)) return word;
    }
    return null;
}

/**
 * Chạy mọi luật dựa trên nội dung. Trả về vi phạm ĐẦU TIÊN tìm được: một tin chỉ bị xoá
 * một lần, và ghi nhiều strike cho cùng một tin sẽ làm ngưỡng leo thang mất ý nghĩa.
 *
 * Thứ tự kiểm đi từ nguy hiểm nhất (link lừa đảo, invite server khác) xuống mức phiền
 * (VIẾT HOA) để log ghi đúng lý do đáng quan tâm nhất.
 */
export function checkContentRules(facts: ContentFacts, rules: RuleTable): RuleHit | null {
    const { content, mentionCount } = facts;

    const scam = rules.scamLink;
    if (scam?.enabled !== false && scam) {
        const safeHosts: string[] = Array.isArray(scam.safeHosts) ? scam.safeHosts : [];
        for (const host of extractHosts(content)) {
            if (IMPERSONATED_KEYWORDS.test(host) && !isOfficialHost(host, safeHosts)) {
                return { rule: 'scamLink', detail: `Tên miền mạo danh: \`${host}\`` };
            }
        }
    }

    const invite = rules.inviteLink;
    if (invite?.enabled && INVITE_PATTERN.test(content)) {
        return { rule: 'inviteLink', detail: 'Link mời server khác' };
    }

    const links = rules.links;
    if (links?.enabled) {
        const allow: string[] = Array.isArray(links.allowHosts) ? links.allowHosts : [];
        const offending = extractHosts(content).find(host => !isOfficialHost(host, allow));
        if (offending) return { rule: 'links', detail: `Link ngoài danh sách cho phép: \`${offending}\`` };
    }

    const mention = rules.massMention;
    if (mention?.enabled && mentionCount > (mention.limit ?? 6)) {
        return { rule: 'massMention', detail: `Ping ${mentionCount} người/role trong một tin` };
    }

    const banned = rules.bannedWords;
    if (banned?.enabled) {
        const hit = bannedWordHit(content, Array.isArray(banned.words) ? banned.words : []);
        if (hit) return { rule: 'bannedWords', detail: `Từ khoá bị cấm: \`${hit}\`` };
    }

    const zalgo = rules.zalgo;
    if (zalgo?.enabled) {
        const { marks, base } = zalgoScore(content);
        // Hai điều kiện cùng lúc: đủ NHIỀU dấu phụ (một câu ngắn có dấu lạ không đáng
        // xoá) và đủ DÀY (tỷ lệ cao hơn mọi ngôn ngữ dùng dấu phụ thật).
        if (marks >= (zalgo.minMarks ?? 8) && base > 0 && marks / base >= (zalgo.ratio ?? 0.6)) {
            return { rule: 'zalgo', detail: `Ký tự phá layout (${marks} dấu phụ trên ${base} ký tự)` };
        }
    }

    const emoji = rules.emojiSpam;
    if (emoji?.enabled) {
        const count = (content.match(CUSTOM_EMOJI_PATTERN) || []).length
            + (content.replace(CUSTOM_EMOJI_PATTERN, '').match(UNICODE_EMOJI_PATTERN) || []).length;
        if (count > (emoji.limit ?? 12)) return { rule: 'emojiSpam', detail: `${count} emoji trong một tin` };
    }

    const newline = rules.newlineSpam;
    if (newline?.enabled) {
        const lines = (content.match(/\n/g) || []).length;
        if (lines > (newline.limit ?? 15)) return { rule: 'newlineSpam', detail: `${lines + 1} dòng trong một tin` };
    }

    const caps = rules.caps;
    if (caps?.enabled) {
        const { ratio, letters } = capsRatio(content);
        // minLength tính theo số CHỮ CÁI: "OK!!!!!!!!!!!!" dài 14 ký tự nhưng chỉ 2 chữ
        // cái — chặn nó là chặn oan.
        if (letters >= (caps.minLength ?? 12) && ratio * 100 >= (caps.percent ?? 75)) {
            return { rule: 'caps', detail: `${Math.round(ratio * 100)}% chữ hoa` };
        }
    }

    return null;
}
