export type GiveawayDraft = {
    creatorId: string;
    channelId?: string | null;
    hostId?: string | null;
    pingRoleId?: string | null;
    requiredRoleId?: string | null;
    minLevel?: number | null;
    minScoin?: number | null;
    entryCost?: number | null;
    rewardType?: string | null;
    rewardSecret?: string | null;
    publicMediaUrl?: string | null;
};

const drafts = new Map<string, GiveawayDraft & { expiresAt: number }>();

function removeExpiredDrafts(now = Date.now()) {
    for (const [id, draft] of drafts) {
        if (draft.expiresAt < now) drafts.delete(id);
    }
}

export function saveGiveawayDraft(draft: GiveawayDraft) {
    removeExpiredDrafts();
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    drafts.set(id, { ...draft, expiresAt: Date.now() + 15 * 60_000 });
    return id;
}

export function takeGiveawayDraft(id: string, creatorId: string) {
    const draft = drafts.get(id);
    if (!draft || draft.expiresAt < Date.now() || draft.creatorId !== creatorId) {
        drafts.delete(id);
        return null;
    }
    drafts.delete(id);
    return draft;
}
