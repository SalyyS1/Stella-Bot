// Du lieu mau cho toi khi cong admin (phase 2) mo duong /api/* that.
//
// So lieu bat chuoc DB that ngay 29/8/2026 (41 don, 22 showcase, 96.483 scoin...) de
// giao dien duoc thu voi ti le that: nhieu CLAIMED hon OPEN, co don qua han, co ticket
// mo lau. Moi ngay/gio deu la chuoi ISO co dinh — mock KHONG dung Date.now() de moi lan
// render ra cung mot man hinh (con "3 ngay truoc" la viec cua format.ts luc runtime).
import type {
    BudgetBucket, CommunityOverview, FreelancerRow, MemberDetail, MemberSummary,
    OrderDetail, OrderListItem, OrderTrend, Page, ShowcaseRow, TicketRow
} from "./panel-types";

// ── Don hang ─────────────────────────────────────────────────────────────────
//
// `skill` la KHOA CO DINH tu config.skills ben bot (design | dev | video | writing |
// other), khong phai chu tu do — `service` moi la chu tu do. Dat sai khoa o day nghia la
// bo loc ky nang duoc dung dua tren nhung gia tri khong ton tai trong DB.

const ORDERS: OrderListItem[] = [
    {
        id: 41, kind: "PAID", status: "OPEN", skill: "other", service: "Build map event Trung Thu",
        budgetLabel: "2.500.000 VND", budgetAmount: 2_500_000, dueDate: "2026-09-15T17:00:00.000Z",
        requesterId: "1097441479351336961", claimedById: null, hasOrderChannel: false,
        createdAt: "2026-09-02T08:12:00.000Z", updatedAt: "2026-09-02T08:12:00.000Z"
    },
    {
        id: 40, kind: "PAID", status: "CLAIMED", skill: "dev", service: "Plugin minigame đua thuyền",
        budgetLabel: "4.000.000 VND", budgetAmount: 4_000_000, dueDate: "2026-09-05T17:00:00.000Z",
        requesterId: "955313148200624129", claimedById: "895505054927315026", hasOrderChannel: true,
        createdAt: "2026-08-28T10:30:00.000Z", updatedAt: "2026-09-01T14:20:00.000Z"
    },
    {
        id: 39, kind: "PAID", status: "CLAIMED", skill: "dev", service: "Config ItemsAdder full thư mục",
        budgetLabel: "800.000 VND", budgetAmount: 800_000, dueDate: "2026-08-30T17:00:00.000Z",
        requesterId: "334996834659336193", claimedById: "1097441479351336961", hasOrderChannel: true,
        createdAt: "2026-08-25T09:00:00.000Z", updatedAt: "2026-08-29T11:45:00.000Z"
    },
    {
        id: 38, kind: "PAID", status: "OPEN", skill: "design", service: "Vẽ banner + logo server",
        budgetLabel: "60 USD", budgetAmount: 60, dueDate: null,
        requesterId: "905383380554752073", claimedById: null, hasOrderChannel: false,
        createdAt: "2026-08-24T16:40:00.000Z", updatedAt: "2026-08-24T16:40:00.000Z"
    },
    {
        id: 37, kind: "PAID", status: "RATED", skill: "other", service: "Lobby 200x200 chủ đề mùa hè",
        budgetLabel: "3.200.000 VND", budgetAmount: 3_200_000, dueDate: "2026-08-20T17:00:00.000Z",
        requesterId: "407898780252373012", claimedById: "955313148200624129", hasOrderChannel: true,
        createdAt: "2026-08-10T07:15:00.000Z", updatedAt: "2026-08-21T19:30:00.000Z"
    },
    {
        id: 36, kind: "PAID", status: "DONE", skill: "design", service: "Model pet rồng GeckoLib",
        budgetLabel: "1.500.000 VND", budgetAmount: 1_500_000, dueDate: "2026-08-28T17:00:00.000Z",
        requesterId: "895505054927315026", claimedById: "761443927902388245", hasOrderChannel: true,
        createdAt: "2026-08-15T13:00:00.000Z", updatedAt: "2026-08-27T20:10:00.000Z"
    },
    {
        id: 35, kind: "PAID", status: "CLOSED", skill: "dev", service: "Sửa lỗi plugin shop cũ",
        budgetLabel: "500k (chữ)", budgetAmount: null, dueDate: null,
        requesterId: "516100491483021314", claimedById: null, hasOrderChannel: false,
        createdAt: "2026-08-12T11:30:00.000Z", updatedAt: "2026-08-18T09:00:00.000Z"
    },
    {
        id: 34, kind: "FREE", status: "OPEN", skill: "writing", service: "Viết mô tả 20 item cho shop",
        budgetLabel: "Không ghi", budgetAmount: null, dueDate: "2026-09-20T17:00:00.000Z",
        requesterId: "974882364415176716", claimedById: null, hasOrderChannel: false,
        createdAt: "2026-08-30T15:20:00.000Z", updatedAt: "2026-08-30T15:20:00.000Z"
    }
];

const ORDER_DETAIL_EXTRAS: Record<number, Omit<OrderDetail, keyof OrderListItem>> = {
    40: {
        description: "Cần plugin đua thuyền 8 người, checkpoint, bảng xếp hạng, phần thưởng theo hạng. Server Paper 1.21.4.",
        other: null,
        referenceUrls: [
            "https://cdn.discordapp.com/attachments/1/2/thuyen-ref-1.png",
            "https://cdn.discordapp.com/attachments/1/2/thuyen-ref-2.png"
        ],
        completedAt: null,
        closedAt: null,
        claims: [{ claimerId: "895505054927315026", status: "ACTIVE", createdAt: "2026-09-01T14:20:00.000Z" }],
        reviews: []
    },
    37: {
        description: "Lobby 200x200, chủ đề mùa hè, có khu spawn + khu shop + đường ray parkour.",
        other: "Ưu tiên tông màu cam/xanh biển.",
        referenceUrls: [],
        completedAt: "2026-08-21T18:00:00.000Z",
        closedAt: null,
        claims: [{ claimerId: "955313148200624129", status: "ACTIVE", createdAt: "2026-08-11T08:00:00.000Z" }],
        reviews: [{
            reviewerId: "407898780252373012", targetId: "955313148200624129",
            rating: 5, note: null, createdAt: "2026-08-21T19:30:00.000Z"
        }]
    }
};

// ── Tong quan ────────────────────────────────────────────────────────────────

const OVERVIEW: CommunityOverview = {
    orders: {
        byStatus: { OPEN: 4, CLAIMED: 17, DONE: 1, RATED: 6, CLOSED: 13 },
        byKind: { PAID: 36, FREE: 5 },
        unclaimedTooLong: 4,
        overdue: 1,
        activeTotal: 21
    },
    openTickets: 2,
    newMembers7d: 26,
    scoinInCirculation: 96_483,
    rating30d: { avg: 4.2, count: 5 },
    ratingPrev30d: { avg: 5, count: 1 },
    generatedAt: "2026-09-03T15:00:00.000Z"
};

const TREND: OrderTrend = {
    days: 30,
    created: [
        { day: "2026-08-05", count: 1 }, { day: "2026-08-07", count: 2 },
        { day: "2026-08-10", count: 1 }, { day: "2026-08-12", count: 3 },
        { day: "2026-08-15", count: 2 }, { day: "2026-08-18", count: 1 },
        { day: "2026-08-20", count: 2 }, { day: "2026-08-24", count: 3 },
        { day: "2026-08-25", count: 1 }, { day: "2026-08-28", count: 2 },
        { day: "2026-08-30", count: 3 }, { day: "2026-09-01", count: 1 },
        { day: "2026-09-02", count: 2 }
    ],
    completed: [
        { day: "2026-08-14", count: 1 }, { day: "2026-08-18", count: 1 },
        { day: "2026-08-21", count: 2 }, { day: "2026-08-27", count: 1 },
        { day: "2026-09-01", count: 1 }
    ],
    ratings: [
        { day: "2026-08-14", avgRating: 5, count: 1 },
        { day: "2026-08-21", avgRating: 4.5, count: 2 },
        { day: "2026-08-27", avgRating: 3.5, count: 2 }
    ]
};

const BUDGET_BUCKETS: BudgetBucket[] = [
    { label: "< 200k", from: 0, to: 200_000, count: 0 },
    { label: "200k – 500k", from: 200_000, to: 500_000, count: 1 },
    { label: "500k – 1tr", from: 500_000, to: 1_000_000, count: 2 },
    { label: "1tr – 3tr", from: 1_000_000, to: 3_000_000, count: 3 },
    { label: "3tr – 10tr", from: 3_000_000, to: 10_000_000, count: 3 },
    { label: "≥ 10tr", from: 10_000_000, to: null, count: 0 }
];

// ── Freelancer ───────────────────────────────────────────────────────────────

const FREELANCERS: FreelancerRow[] = [
    {
        userId: "1097441479351336961", avgRating: 5, jobCount: 2, verified: true,
        openForWork: true, headline: "Config ItemsAdder / MythicMobs, nhận job vừa và nhỏ",
        priceText: "Config theo yêu cầu: từ 300k\nSetup server full: từ 2tr", profileUpdatedAt: "2026-09-01T10:00:00.000Z"
    },
    {
        userId: "955313148200624129", avgRating: 4.7, jobCount: 6, verified: true,
        openForWork: true, headline: "Builder — lobby, map event, spawn",
        priceText: "Lobby nhỏ 1tr5 · Map event từ 2tr5 · Deal thêm nếu gấp", profileUpdatedAt: "2026-08-28T09:00:00.000Z"
    },
    {
        userId: "895505054927315026", avgRating: 4.3, jobCount: 4, verified: false,
        openForWork: false, headline: "Plugin Paper/Folia",
        priceText: null, profileUpdatedAt: "2026-07-15T09:00:00.000Z"
    },
    {
        userId: "761443927902388245", avgRating: null, jobCount: 0, verified: false,
        openForWork: true, headline: "Model GeckoLib + Blockbench", priceText: "Pet đơn giản 800k",
        profileUpdatedAt: "2026-09-02T12:00:00.000Z"
    }
];

// ── Thanh vien ───────────────────────────────────────────────────────────────

const MEMBERS: MemberSummary[] = [
    {
        id: "1243516743918293003", level: 42, xp: 12_480, totalMessages: 15_203, scoinBalance: 8_450,
        contributionScore: 156, verified: true, hasPortfolio: true, joinedAt: "2025-11-02T04:00:00.000Z"
    },
    {
        id: "955313148200624129", level: 38, xp: 9_720, totalMessages: 11_847, scoinBalance: 12_030,
        contributionScore: 203, verified: true, hasPortfolio: true, joinedAt: "2025-08-14T10:30:00.000Z"
    },
    {
        id: "1097441479351336961", level: 35, xp: 8_150, totalMessages: 9_412, scoinBalance: 5_670,
        contributionScore: 98, verified: true, hasPortfolio: false, joinedAt: "2025-12-20T15:00:00.000Z"
    },
    {
        id: "895505054927315026", level: 29, xp: 5_900, totalMessages: 7_255, scoinBalance: 3_120,
        contributionScore: 87, verified: false, hasPortfolio: true, joinedAt: "2026-01-05T08:45:00.000Z"
    },
    {
        id: "974882364415176716", level: 12, xp: 1_100, totalMessages: 1_530, scoinBalance: 420,
        contributionScore: 6, verified: false, hasPortfolio: false, joinedAt: "2026-08-28T18:20:00.000Z"
    }
];

const MEMBER_DETAIL: MemberDetail = {
    ...MEMBERS[0],
    expertScore: 34, scoinEarnedTotal: 21_300, dailyStreak: 17,
    voiceSeconds: 184_500, inviteTotal: 12, invitePending: 2,
    activeWarns: 0, modCaseTotal: 1, ordersRequested: 3, ordersClaimed: 0, blacklisted: false
};

// ── Ticket ───────────────────────────────────────────────────────────────────

const TICKETS: TicketRow[] = [
    {
        id: 128, openerId: "974882364415176716", topic: "Hỏi về quy trình đặt đơn build map",
        claimedBy: null, closedBy: null, createdAt: "2026-08-31T09:15:00.000Z", closedAt: null, ageHours: 78
    },
    {
        id: 127, openerId: "516100491483021314", topic: "Khiếu nại đơn #35",
        claimedBy: "1243516743918293003", closedBy: null, createdAt: "2026-09-02T14:00:00.000Z", closedAt: null, ageHours: 25
    },
    {
        id: 126, openerId: "905383380554752073", topic: "Xin role Verified",
        claimedBy: "1243516743918293003", closedBy: "1243516743918293003",
        createdAt: "2026-08-29T10:00:00.000Z", closedAt: "2026-08-29T16:30:00.000Z", ageHours: 7
    }
];

// ── Showcase ─────────────────────────────────────────────────────────────────

const SHOWCASES: ShowcaseRow[] = [
    {
        messageId: "1490001", channelId: "1401215370978922506", authorId: "955313148200624129",
        title: "Lobby mùa hè 200x200 — đơn #37", tagName: "Build", status: "PUBLISHED",
        forumThreadId: "1490100", createdAt: "2026-08-22T10:00:00.000Z", publishedAt: "2026-08-23T08:00:00.000Z"
    },
    {
        messageId: "1490002", channelId: "1401215370978922506", authorId: "761443927902388245",
        title: "Pet rồng GeckoLib có animation bay", tagName: "Model", status: "PUBLISHED",
        forumThreadId: "1490101", createdAt: "2026-08-27T14:00:00.000Z", publishedAt: "2026-08-28T09:00:00.000Z"
    },
    {
        messageId: "1490003", channelId: "1401215370978922506", authorId: "1097441479351336961",
        title: "Bộ config ItemsAdder 120 item custom", tagName: "Config", status: "PUBLISHED",
        forumThreadId: null, createdAt: "2026-08-18T11:00:00.000Z", publishedAt: "2026-08-19T10:00:00.000Z"
    },
    {
        messageId: "1490004", channelId: "1401215370978922506", authorId: "895505054927315026",
        title: "Trailer server 45 giây", tagName: "Video", status: "VOTING",
        forumThreadId: null, createdAt: "2026-09-02T19:00:00.000Z", publishedAt: null
    },
    {
        messageId: "1490005", channelId: "1401215370978922506", authorId: "955313148200624129",
        title: "Spawn hub 3 tầng", tagName: "Build", status: "PUBLISHING",
        forumThreadId: "1490105", createdAt: "2026-09-01T08:00:00.000Z", publishedAt: null
    }
];

// ── Do day cho phan trang ────────────────────────────────────────────────────
//
// Tam dong don + nam thanh vien viet tay o tren la de xem giao dien voi noi dung THAT.
// Nhung mot trang thi khong bam thu duoc nut sang trang va khong thay duoc bo loc co
// hieu luc — nen sinh them dong cho du so luong that (41 don, 52 thanh vien). Sinh bang
// cong thuc theo chi so, KHONG dung Math.random: moi lan mo ra cung mot man hinh.

const FILLER_SKILLS = ["design", "dev", "video", "writing", "other"];
const FILLER_STATUSES = ["CLOSED", "RATED", "CLAIMED", "CLOSED", "RATED"];
const FILLER_USERS = [
    "1243516743918293003", "955313148200624129", "1097441479351336961",
    "895505054927315026", "974882364415176716", "516100491483021314"
];

function fillerOrders(count: number, firstId: number): OrderListItem[] {
    return Array.from({ length: count }, (_unused, i) => {
        const id = firstId - i;
        const day = String(28 - (i % 27)).padStart(2, "0");
        const free = i % 7 === 0;
        const amount = 300_000 * ((i % 9) + 1);
        return {
            id,
            kind: free ? "FREE" : "PAID",
            status: FILLER_STATUSES[i % FILLER_STATUSES.length],
            skill: FILLER_SKILLS[i % FILLER_SKILLS.length],
            service: `Đơn cũ #${id}`,
            // Don FREE khong co ngan sach — de trong nhu bot: formatBudget tra "Không ghi".
            budgetLabel: free ? "Không ghi" : `${amount.toLocaleString("vi-VN")} VND`,
            budgetAmount: free ? null : amount,
            dueDate: null,
            requesterId: FILLER_USERS[i % FILLER_USERS.length],
            claimedById: FILLER_USERS[(i + 2) % FILLER_USERS.length],
            hasOrderChannel: i % 3 === 0,
            createdAt: `2026-07-${day}T09:00:00.000Z`,
            updatedAt: `2026-07-${day}T18:00:00.000Z`
        };
    });
}

function fillerMembers(count: number): MemberSummary[] {
    return Array.from({ length: count }, (_unused, i) => {
        const day = String((i % 27) + 1).padStart(2, "0");
        return {
            // ID gia nhung dung dinh dang Discord (17-19 chu so) de shortId hien dung.
            id: String(1300000000000000000 + i * 7919),
            level: 20 - (i % 18),
            xp: 4200 - i * 61,
            totalMessages: 5600 - i * 87,
            scoinBalance: 2400 - i * 39,
            contributionScore: 60 - (i % 55),
            verified: i % 4 === 0,
            hasPortfolio: i % 5 === 0,
            joinedAt: `2026-0${(i % 6) + 1}-${day}T12:00:00.000Z`
        };
    });
}

const ALL_ORDERS: OrderListItem[] = [...ORDERS, ...fillerOrders(33, 33)];
const ALL_MEMBERS: MemberSummary[] = [...MEMBERS, ...fillerMembers(47)];

// ── Router cua mock ──────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/** Giong `VIEWABLE_STATUS` ben src/panel/data/showcase-queries.ts. */
const VIEWABLE_SHOWCASE_STATUS = new Set(["VOTING", "PUBLISHING", "PUBLISHED"]);

/** Kep giong `resolvePaging` ben bot: gia tri xau thi ve mac dinh, khong nem loi. */
function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(Math.floor(value), max));
}

/** Phan trang that: nut sang trang khong bam thu duoc thi khong biet no co chay. */
function paginate<T>(items: T[], query: URLSearchParams): Page<T> {
    const pageSize = clampInt(query.get("pageSize"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    const page = Math.min(clampInt(query.get("page"), 1, 1, Number.MAX_SAFE_INTEGER), pageCount);
    const start = (page - 1) * pageSize;
    return {
        items: items.slice(start, start + pageSize),
        total: items.length,
        page,
        pageSize,
        pageCount
    };
}

/** "true"/"1" -> true, "false"/"0" -> false, thieu -> undefined (khong loc). */
function boolParam(query: URLSearchParams, name: string): boolean | undefined {
    const raw = query.get(name);
    if (raw === null || raw === "") return undefined;
    return raw === "true" || raw === "1";
}

/**
 * Tra du lieu mau cho mot duong dan /api/*. Ten tham so va cach kep GIONG hop dong that
 * (`OrderFilter`, `MemberSearchFilter`, `TicketFilter`... ben src/panel/data) — mock lech
 * ten tham so nghia la giao dien duoc dung dua vao mot hop dong khong ton tai.
 */
export function mockResponse(path: string): unknown {
    const [rawPath, rawQuery = ""] = path.split("?");
    const clean = rawPath.replace(/\/+$/, "");
    const query = new URLSearchParams(rawQuery);

    if (clean === "/api/overview") return OVERVIEW;
    if (clean === "/api/trends") return TREND;
    if (clean === "/api/budget-distribution") return BUDGET_BUCKETS;

    if (clean === "/api/orders") {
        const status = query.get("status");
        const kind = query.get("kind");
        const skill = query.get("skill");
        const rows = ALL_ORDERS.filter(order =>
            (!status || order.status === status) &&
            (!kind || order.kind === kind) &&
            (!skill || order.skill === skill));
        return paginate(rows, query);
    }

    if (/^\/api\/orders\/\d+$/.test(clean)) {
        const id = Number(clean.split("/").pop());
        const item = ALL_ORDERS.find(order => order.id === id);
        // Khong tim thay thi 404 that, khong tra don khac: tra don khac la panel noi doi.
        if (!item) return null;
        const extras = ORDER_DETAIL_EXTRAS[item.id] ?? {
            description: `Nội dung đơn #${item.id} (dữ liệu mẫu).`,
            other: null,
            referenceUrls: [],
            completedAt: item.status === "RATED" || item.status === "DONE" ? item.updatedAt : null,
            closedAt: item.status === "CLOSED" ? item.updatedAt : null,
            claims: item.claimedById
                ? [{ claimerId: item.claimedById, status: "ACTIVE", createdAt: item.updatedAt }]
                : [],
            reviews: []
        };
        return { ...item, ...extras };
    }

    if (clean === "/api/freelancers") {
        const openOnly = boolParam(query, "openOnly");
        const rows = openOnly ? FREELANCERS.filter(row => row.openForWork === true) : FREELANCERS;
        return paginate(rows, query);
    }

    if (clean === "/api/members") {
        // Giong `searchMembers`: chi giu chu so roi khop "contains". Discord ID la so, va
        // ten hien thi khong nam trong DB.
        const digits = (query.get("q") ?? "").replace(/\D/g, "").slice(0, 25);
        const rows = digits ? ALL_MEMBERS.filter(member => member.id.includes(digits)) : ALL_MEMBERS;
        return paginate(rows, query);
    }

    if (/^\/api\/members\/\d+$/.test(clean)) {
        const id = clean.split("/").pop() as string;
        const summary = ALL_MEMBERS.find(member => member.id === id);
        if (!summary) return null;
        return { ...MEMBER_DETAIL, ...summary };
    }

    if (clean === "/api/tickets") {
        const open = boolParam(query, "open");
        const rows = open === undefined
            ? TICKETS
            : TICKETS.filter(ticket => (ticket.closedAt === null) === open);
        return paginate(rows, query);
    }

    if (clean === "/api/showcases") {
        // Giong `listShowcases`: LUON loc dung mot trang thai, tham so la/thieu thi ve
        // PUBLISHED. OPTED_OUT khong bao gio ra — ke ca khi ai do go tay vao URL.
        const requested = query.get("status");
        const status = requested && VIEWABLE_SHOWCASE_STATUS.has(requested)
            ? requested
            : "PUBLISHED";
        const authorId = query.get("authorId");
        const rows = SHOWCASES.filter(row =>
            row.status === status &&
            (!authorId || row.authorId === authorId));
        return paginate(rows, query);
    }

    throw new Error(`mock chưa có đường dẫn: ${path}`);
}

