import { Client, EmbedBuilder, TextChannel, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { sendAdminLog } from '../utils/adminLog';

// Facebook Page cross-post, ADMIN-APPROVAL gated. A candidate is persisted +
// mirrored to the admin channel with Approve/Reject buttons; only a mod click
// publishes. Brand safety > convenience — a credit rule does NOT cover content
// policy/spam/sensitive media, so full-auto was rejected.
//
// Security/reliability guards (from red-team):
// - token via Authorization header, NEVER query string; redacted before any log.
// - atomic PENDING->PUBLISHING claim so a double-click can't double-publish.
// - re-fetch the LIVE Discord attachment URL at approval time (candidate URL may
//   be an expired signed CDN URL by the time a mod approves).
// - reconcile PUBLISHING rows on startup before allowing re-approval.
// - fail-closed when token missing/expired.

function getToken(): string | null {
    return process.env.FB_PAGE_ACCESS_TOKEN || null;
}

function isEnabled(): boolean {
    return config.facebook.enabled && !!config.facebook.pageId && !!getToken();
}

// Strip any token/secret from a string before it can reach a Discord log.
function redact(input: unknown): string {
    let s = typeof input === 'string' ? input : JSON.stringify(input ?? '');
    const token = getToken();
    if (token) s = s.split(token).join('[REDACTED_TOKEN]');
    // Defense in depth: scrub common token param shapes even if the value differs.
    s = s.replace(/access_token=[^&\s"]+/gi, 'access_token=[REDACTED]');
    return s.slice(0, 800);
}

// Publish a photo to the Page via Graph API. Token goes in the POST body, never
// the URL. Returns the FB post id on success, throws a redacted error otherwise.
async function publishPhotoToPage(imageUrl: string, caption: string): Promise<string> {
    const token = getToken();
    if (!token) throw new Error('FB token missing (fail-closed).');
    const endpoint = `https://graph.facebook.com/${config.facebook.graphVersion}/${config.facebook.pageId}/photos`;
    const body = new URLSearchParams({ url: imageUrl, caption, access_token: token });

    const res = await fetch(endpoint, { method: 'POST', body });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        // json.error.message can echo the request; redact before surfacing.
        throw new Error(redact((json as any)?.error?.message || `Graph API ${res.status}`));
    }
    const postId = (json as any)?.post_id || (json as any)?.id;
    if (!postId) throw new Error('Graph API returned no post id.');
    return String(postId);
}

// Re-fetch the LIVE attachment URL from the source Discord message so we hand FB
// a fresh signed URL (candidate URL may have expired since it was queued).
async function freshImageUrl(client: Client, channelId: string, messageId: string): Promise<string | null> {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return null;
    const msg = await (channel as TextChannel).messages.fetch(messageId).catch(() => null);
    const att = msg?.attachments.find(a => a.contentType?.startsWith('image/'));
    return att?.url || null;
}

// Queue a cross-post candidate and mirror it to the admin channel for approval.
// No-op when the feature is disabled (fail-closed).
export async function queueCrossPostCandidate(client: Client, options: {
    sourceChannelId: string;
    sourceMessageId: string;
    authorId: string;
    caption: string;
}): Promise<void> {
    if (!isEnabled()) return;

    const candidate = await prisma.facebookCrossPost.create({
        data: {
            sourceChannelId: options.sourceChannelId,
            sourceMessageId: options.sourceMessageId,
            authorId: options.authorId,
            caption: options.caption.slice(0, 1500),
            status: 'PENDING'
        }
    }).catch(() => null);
    if (!candidate) return;

    const adminChannel = await client.channels.fetch(config.channels.botLog).catch(() => null);
    if (!adminChannel?.isTextBased() || !('send' in adminChannel)) return;

    const embed = new EmbedBuilder()
        .setColor('#4267B2')
        .setTitle('Facebook cross-post — chờ duyệt')
        .setDescription(options.caption.slice(0, 500))
        .addFields(
            { name: 'Tác giả', value: `<@${options.authorId}>`, inline: true },
            { name: 'Nguồn', value: `<#${options.sourceChannelId}>`, inline: true }
        )
        .setFooter({ text: `Candidate #${candidate.id}` })
        .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`fbpost_approve_${candidate.id}`).setLabel('Đăng lên Facebook').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`fbpost_reject_${candidate.id}`).setLabel('Bỏ qua').setStyle(ButtonStyle.Secondary)
    );

    await (adminChannel as TextChannel).send({
        embeds: [embed],
        components: [row],
        allowedMentions: { parse: [] }
    }).catch(() => {});
}

// Handle a mod Approve click. Atomic PENDING->PUBLISHING claim first so a
// double-click / two-device race can't double-publish. Returns a status string.
export async function approveCrossPost(client: Client, candidateId: number): Promise<'published' | 'already' | 'failed' | 'disabled'> {
    if (!isEnabled()) return 'disabled';

    const claimed = await prisma.facebookCrossPost.updateMany({
        where: { id: candidateId, status: 'PENDING' },
        data: { status: 'PUBLISHING' }
    });
    if (claimed.count === 0) return 'already'; // lost the race or not pending

    const candidate = await prisma.facebookCrossPost.findUnique({ where: { id: candidateId } });
    if (!candidate) return 'failed';

    try {
        const imageUrl = await freshImageUrl(client, candidate.sourceChannelId, candidate.sourceMessageId);
        if (!imageUrl) throw new Error('Không lấy được ảnh nguồn (tin nhắn đã xóa hoặc hết hạn).');

        const caption = `${candidate.caption}\n\n— <@${candidate.authorId}> · Stella Studio`;
        const fbPostId = await publishPhotoToPage(imageUrl, caption);

        await prisma.facebookCrossPost.updateMany({
            where: { id: candidateId, status: 'PUBLISHING' },
            data: { status: 'PUBLISHED', fbPostId, publishedAt: new Date() }
        });
        return 'published';
    } catch (error) {
        // Restore to PENDING so a mod can retry; record the redacted error.
        await prisma.facebookCrossPost.updateMany({
            where: { id: candidateId, status: 'PUBLISHING' },
            data: { status: 'PENDING', lastError: redact(error instanceof Error ? error.message : error) }
        }).catch(() => {});
        await sendAdminLog(client, {
            title: 'Facebook cross-post failed',
            color: '#e74c3c',
            fields: [
                { name: 'Candidate', value: `#${candidateId}`, inline: true },
                { name: 'Error', value: redact(error instanceof Error ? error.message : error) }
            ]
        }).catch(() => {});
        return 'failed';
    }
}

export async function rejectCrossPost(candidateId: number): Promise<void> {
    await prisma.facebookCrossPost.updateMany({
        where: { id: candidateId, status: { in: ['PENDING', 'PUBLISHING'] } },
        data: { status: 'DISCARDED' }
    }).catch(() => {});
}

// On startup, any row stuck in PUBLISHING means the bot crashed mid-publish. We
// can't be sure FB received it, so DON'T blindly re-post: flag for manual review.
// (No bot-owned dedup marker on the Page to reconcile against for photo posts.)
export async function reconcilePendingCrossPosts(client: Client): Promise<void> {
    if (!config.facebook.enabled) return;
    const stuck = await prisma.facebookCrossPost.findMany({ where: { status: 'PUBLISHING' } }).catch(() => []);
    if (!stuck.length) return;
    await prisma.facebookCrossPost.updateMany({
        where: { status: 'PUBLISHING' },
        data: { status: 'NEEDS_REVIEW' }
    }).catch(() => {});
    await sendAdminLog(client, {
        title: 'Facebook cross-post: reconciliation',
        color: '#e67e22',
        description: `${stuck.length} bài đang PUBLISHING khi bot khởi động lại — đã chuyển sang NEEDS_REVIEW. Kiểm tra Page thủ công trước khi đăng lại (tránh đăng trùng).`
    }).catch(() => {});
}
