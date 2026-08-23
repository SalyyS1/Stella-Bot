import { Message } from 'discord.js';
import { getMainMusicEntry } from './music-client-pool';
import { buildMusicPanel, musicPanelForSession } from './music-panel';
import { MusicSession } from './music-session-router';

// ============================================================
//  MUSIC PANEL MESSAGE — nho panel cua tung session de tu update
// ============================================================
// Panel luon do bot chinh dang (satellite khong gui tin nhan), nen fetch/edit
// deu dung client cua bot chinh.

type PanelRef = {
    channelId: string;
    messageId: string;
};

const panels = new Map<string, PanelRef>();

function panelKey(session: MusicSession) {
    return `${session.entry.key}:${session.guildId}`;
}

export function rememberPanelMessage(session: MusicSession, message: Message | null) {
    if (!message) return;
    panels.set(panelKey(session), { channelId: message.channelId, messageId: message.id });
}

export function forgetPanelMessage(entryKey: string, guildId: string) {
    panels.delete(`${entryKey}:${guildId}`);
}

/**
 * Cap nhat panel dang hien thi cua session.
 * newCard = true khi doi bai (render lai anh card), false khi chi doi trang thai.
 */
export async function refreshSessionPanel(session: MusicSession, options: { newCard?: boolean } = {}) {
    const ref = panels.get(panelKey(session));
    const main = getMainMusicEntry();
    if (!ref || !main) return;

    const channel = await main.client.channels.fetch(ref.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const message = await (channel as any).messages?.fetch(ref.messageId).catch(() => null);
    if (!message) {
        panels.delete(panelKey(session));
        return;
    }

    const payload = options.newCard
        ? await buildMusicPanel(session)
        : musicPanelForSession(session, { cardAttached: true });
    await message.edit(payload).catch(() => {});
}
