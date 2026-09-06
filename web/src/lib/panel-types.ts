// Kieu du lieu cua API panel — CHEP TAY tu src/panel/data/* cua bot.
//
// Vi sao chep tay ma khong import: web/ la mot project TypeScript rieng (bot compile
// CommonJS, web compile bundler/ESM) va bot khong xuat ban types. Chep tay nghia la khi
// bot doi shape thi day phai doi theo — chap nhan, vi phase 2 se noi hai ben bang mot
// lan chay thu that; con import cheo hai tsconfig la mot lop phuc tap thuong truc.
//
// Nguon cua tung khoi ghi ngay tren khoi do. Dung doi ten field o day cho "dep".

// ── pagination.ts ────────────────────────────────────────────────────────────
export interface Page<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
}

// ── order-queries.ts ─────────────────────────────────────────────────────────
export interface OrderOverview {
    byStatus: Record<string, number>;
    byKind: Record<string, number>;
    unclaimedTooLong: number;
    overdue: number;
    activeTotal: number;
}

export interface OrderListItem {
    id: number;
    kind: string;
    status: string;
    skill: string | null;
    service: string;
    budgetLabel: string;
    budgetAmount: number | null;
    dueDate: string | null;
    requesterId: string;
    claimedById: string | null;
    hasOrderChannel: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface OrderDetail extends OrderListItem {
    description: string;
    other: string | null;
    referenceUrls: string[];
    completedAt: string | null;
    closedAt: string | null;
    claims: { claimerId: string; status: string; createdAt: string }[];
    reviews: { reviewerId: string; targetId: string; rating: number; note: string | null; createdAt: string }[];
}

// ── overview-queries.ts ──────────────────────────────────────────────────────
export interface CommunityOverview {
    orders: OrderOverview;
    openTickets: number;
    newMembers7d: number;
    scoinInCirculation: number;
    rating30d: { avg: number | null; count: number };
    ratingPrev30d: { avg: number | null; count: number };
    generatedAt: string;
}

// ── freelancer-queries.ts ────────────────────────────────────────────────────
export interface FreelancerRow {
    userId: string;
    avgRating: number | null;
    jobCount: number;
    verified: boolean;
    openForWork: boolean | null;
    headline: string | null;
    priceText: string | null;
    profileUpdatedAt: string | null;
}

// ── member-queries.ts ────────────────────────────────────────────────────────
export interface MemberSummary {
    id: string;
    level: number;
    xp: number;
    totalMessages: number;
    scoinBalance: number;
    contributionScore: number;
    verified: boolean;
    hasPortfolio: boolean;
    joinedAt: string | null;
}

export interface MemberDetail extends MemberSummary {
    expertScore: number;
    scoinEarnedTotal: number;
    dailyStreak: number;
    voiceSeconds: number;
    inviteTotal: number;
    invitePending: number;
    activeWarns: number;
    modCaseTotal: number;
    ordersRequested: number;
    ordersClaimed: number;
    blacklisted: boolean;
}

// ── ticket-queries.ts ────────────────────────────────────────────────────────
export interface TicketRow {
    id: number;
    openerId: string;
    topic: string;
    claimedBy: string | null;
    closedBy: string | null;
    createdAt: string;
    closedAt: string | null;
    ageHours: number;
}

// ── showcase-queries.ts ──────────────────────────────────────────────────────
export interface ShowcaseRow {
    messageId: string;
    channelId: string;
    authorId: string;
    title: string;
    tagName: string;
    status: string;
    forumThreadId: string | null;
    createdAt: string;
    publishedAt: string | null;
}

// ── trend-queries.ts ─────────────────────────────────────────────────────────
export interface DailyPoint {
    day: string;
    count: number;
}

export interface OrderTrend {
    days: number;
    created: DailyPoint[];
    completed: DailyPoint[];
    ratings: { day: string; avgRating: number; count: number }[];
}

export interface BudgetBucket {
    label: string;
    from: number;
    to: number | null;
    count: number;
}
