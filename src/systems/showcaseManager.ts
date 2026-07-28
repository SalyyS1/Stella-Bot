import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Client,
    EmbedBuilder,
    ForumChannel,
    Message,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextChannel,
    User
} from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { messageLink, sendAdminLog } from '../utils/adminLog';
import { adjustScoinTx } from './scoinManager';
import { queueCrossPostCandidate } from './facebookCrossPostManager';

export function isAllowedShowcaseMessage(message: Message): boolean {
    const hasAttachment = message.attachments.some(att =>
        att.contentType?.startsWith('image/') ||
        att.contentType?.startsWith('video/') ||
        /\.(png|jpe?g|gif|webp|mp4|mov|webm)(\?.*)?$/i.test(att.url)
    );
    const hasLink = /(https?:\/\/[^\s]+)/i.test(message.content);
    return hasAttachment || hasLink;
}

function buildShowcaseControlEmbed(user: User, post: { title: string; tagName: string; status: string; messageId: string; channelId: string }, guildId?: string | null): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(post.status === 'OPTED_OUT' ? '#e74c3c' : '#9b59b6')
        .setAuthor({ name: `${user.username} - Showcase Voting`, iconURL: user.displayAvatarURL() })
        .setTitle('Bình chọn Showcase đang hoạt động')
        .setDescription(
            `Bài showcase của bạn đang được đưa vào vòng bình chọn để lên kênh nổi bật.\n\n` +
            `Cần đạt: **${config.showcase.threshold}** ${config.ui.emojis.upvote} từ người khác (vote của bot và của bạn không tính)\n` +
            `Tiêu đề: **${post.title}**\n` +
            `Phân loại: **${post.tagName}**\n` +
            `Trạng thái: **${post.status}**\n\n` +
            `Bạn có thể bấm **Settings** để chỉnh tiêu đề/tag, hoặc **Opt Out** để rút khỏi bình chọn.`
        )
        .setImage(config.showcase.controlGif)
        .addFields({ name: 'Bài gốc', value: `[Mở bài showcase](${messageLink(guildId, post.channelId, post.messageId)})` })
        .setFooter({ text: 'Stella Studio - Showcase nổi bật' })
        .setTimestamp();
}

async function sourceGuildId(client: Client, channelId: string): Promise<string | null> {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    return channel && 'guildId' in channel ? String(channel.guildId) : null;
}

function buildShowcaseControls(messageId: string, disabled = false) {
    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`showcase_settings_${messageId}`)
            .setLabel('Settings')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`showcase_optout_${messageId}`)
            .setLabel('Opt Out')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled)
    );

    const tagRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`showcase_tag_${messageId}`)
            .setPlaceholder('Chọn tag showcase')
            .setDisabled(disabled)
            .addOptions(config.showcase.tags.map(tag =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(tag)
                    .setValue(tag)
            ))
    );

    return [buttonRow, tagRow];
}

export async function createShowcasePost(message: Message): Promise<void> {
    const title = `Showcase by ${message.author.username}`;
    const post = await prisma.showcasePost.upsert({
        where: { messageId: message.id },
        update: {},
        create: {
            messageId: message.id,
            channelId: message.channelId,
            authorId: message.author.id,
            title,
            tagName: 'Nothing'
        }
    });

    let dmMessageId: string | undefined;
    try {
        const dm = await message.author.send({
            embeds: [buildShowcaseControlEmbed(message.author, post, message.guildId)],
            components: buildShowcaseControls(message.id)
        });
        dmMessageId = dm.id;
        await prisma.showcasePost.update({
            where: { messageId: message.id },
            data: { dmMessageId }
        });
    } catch {
        await sendAdminLog(message.client, {
            title: 'Showcase DM failed',
            color: '#e67e22',
            fields: [
                { name: 'User', value: `<@${message.author.id}>`, inline: true },
                { name: 'Message', value: messageLink(message.guildId, message.channelId, message.id) }
            ]
        });
    }

    await sendAdminLog(message.client, {
        title: 'Showcase voting created',
        fields: [
            { name: 'User', value: `<@${message.author.id}>`, inline: true },
            { name: 'Title', value: title, inline: true },
            { name: 'Message', value: messageLink(message.guildId, message.channelId, message.id) }
        ]
    });
}

export async function updateShowcaseTitle(client: Client, messageId: string, user: User, title: string): Promise<boolean> {
    const post = await prisma.showcasePost.findUnique({ where: { messageId } });
    if (!post || post.authorId !== user.id || post.status !== 'VOTING') return false;

    const updated = await prisma.showcasePost.update({
        where: { messageId },
        data: { title: title.trim().slice(0, 100) || `Showcase by ${user.username}` }
    });

    if (updated.dmMessageId) {
        const [dm, guildId] = await Promise.all([
            user.createDM().catch(() => null),
            sourceGuildId(client, updated.channelId)
        ]);
        const dmMessage = await dm?.messages.fetch(updated.dmMessageId).catch(() => null);
        await dmMessage?.edit({
            embeds: [buildShowcaseControlEmbed(user, updated, guildId)],
            components: buildShowcaseControls(messageId)
        }).catch(() => {});
    }

    await sendAdminLog(client, {
        title: 'Showcase settings updated',
        fields: [
            { name: 'User', value: `<@${user.id}>`, inline: true },
            { name: 'Title', value: updated.title, inline: true },
            { name: 'Tag', value: updated.tagName, inline: true }
        ]
    });
    return true;
}

export async function updateShowcaseTag(client: Client, messageId: string, user: User, tagName: string): Promise<boolean> {
    if (!config.showcase.tags.includes(tagName)) return false;
    const post = await prisma.showcasePost.findUnique({ where: { messageId } });
    if (!post || post.authorId !== user.id || post.status !== 'VOTING') return false;

    await prisma.showcasePost.update({ where: { messageId }, data: { tagName } });
    await sendAdminLog(client, {
        title: 'Showcase tag updated',
        fields: [
            { name: 'User', value: `<@${user.id}>`, inline: true },
            { name: 'Tag', value: tagName, inline: true }
        ]
    });
    return true;
}

export async function optOutShowcase(client: Client, messageId: string, user: User): Promise<boolean> {
    const post = await prisma.showcasePost.findUnique({ where: { messageId } });
    if (!post || post.authorId !== user.id || post.status !== 'VOTING') return false;
    await prisma.showcasePost.update({ where: { messageId }, data: { status: 'OPTED_OUT' } });
    await sendAdminLog(client, {
        title: 'Showcase opted out',
        color: '#e74c3c',
        fields: [{ name: 'User', value: `<@${user.id}>`, inline: true }]
    });
    return true;
}

export async function renderShowcaseControl(client: Client, messageId: string, user: User) {
    const post = await prisma.showcasePost.findUnique({ where: { messageId } });
    if (!post) return null;
    const disabled = post.status !== 'VOTING';
    const guildId = await sourceGuildId(client, post.channelId);
    return {
        embeds: [buildShowcaseControlEmbed(user, post, guildId)],
        components: buildShowcaseControls(messageId, disabled)
    };
}

const SHOWCASE_PUBLISH_LEASE_MS = 5 * 60_000;

// Identify a featured post by the backlink its body always carries. Preferred over
// a dedicated marker embed: the link is already required content (the body budget
// reserves room for it, so it survives any truncation), it stays human-meaningful,
// and it adds nothing extra to the create payload that Discord could reject.
// Includes the markdown link's closing paren and is matched against the END of the
// content, because the backlink is the last element in every content variant. A
// looser substring test could be satisfied by a body that merely quotes a link to
// a DIFFERENT showcase post, which would hand that post's thread to the wrong row.
function showcaseBacklinkMarker(channelId: string, messageId: string) {
    return `/${channelId}/${messageId})`;
}

// Release a publish claim so the post returns to voting and can be retried.
// ONLY safe for a claim taken on the FRESH path, where no create has ever run for
// this row. `forumThreadId: null` is NOT enough to prove that: a previous attempt
// that died between threads.create and the checkpoint leaves exactly that state
// while a real orphan thread exists in the forum. Releasing then sends the row
// back to VOTING, and the next attempt takes the fresh path — which deliberately
// skips the orphan scan — producing a second featured thread. So a resumed
// (stale-lease) attempt must never release: it stays PUBLISHING and only the
// retry path, which scans for the orphan first, may move it forward.
async function releasePublishClaim(messageId: string, resumedAttempt: boolean): Promise<void> {
    if (resumedAttempt) return;
    await prisma.showcasePost.updateMany({
        where: { messageId, status: 'PUBLISHING', forumThreadId: null },
        data: { status: 'VOTING' }
    }).catch(() => {});
}

// Discord snowflakes embed their creation time. Used as the trustworthy fallback
// for thread.createdTimestamp, which discord.js leaves null for public threads
// when the gateway payload omits thread_metadata.create_timestamp. Defaulting
// such a thread to 0 would silently drop it from the dedup scan and duplicate
// the featured post, so never guess "old" — derive the real time from the id.
function snowflakeTimestamp(id: string): number {
    try {
        return Number(BigInt(id) >> 22n) + 1_420_070_400_000;
    } catch {
        return 0;
    }
}

// Find a thread this bot already created for `messageId` but failed to record —
// the process died between threads.create and the DB checkpoint, or the create
// timed out client-side after succeeding. Scans active AND archived threads:
// after an outage longer than the forum's auto-archive window the orphan is
// archived, and missing it means publishing a duplicate. `since` bounds how many
// starter messages get fetched, so cost tracks the retry window, not forum size.
async function findRecentlyPublishedThread(forum: ForumChannel, channelId: string, messageId: string, since: number) {
    const active = await (forum.threads as any).fetchActive().catch(() => null);
    if (!active?.threads) return { thread: null, certain: false };
    // Archived threads are returned newest-archived first, so one page covers any
    // realistic orphan. A failure here is not fatal on its own, but it does mean
    // the scan is incomplete — report uncertainty rather than risk a duplicate.
    const archived = await (forum.threads as any).fetchArchived({ type: 'public' }).catch(() => null);
    if (!archived?.threads) return { thread: null, certain: false };

    const marker = showcaseBacklinkMarker(channelId, messageId);
    const candidates = [...active.threads.values(), ...archived.threads.values()]
        .filter((thread: any) => (thread.createdTimestamp ?? snowflakeTimestamp(thread.id)) >= since);
    for (const thread of candidates) {
        const starter = await thread.fetchStarterMessage().catch(() => null);
        if (starter?.content?.trimEnd().endsWith(marker)) return { thread, certain: true };
    }
    return { thread: null, certain: true };
}

// Total attachment bytes we are willing to re-upload. Kept under the 10MB floor
// every guild has, so the create can never be rejected for size — which matters
// because a rejected create is indistinguishable from a timed-out one.
const SHOWCASE_MEDIA_TOTAL_CAP = 8 * 1024 * 1024;
const SHOWCASE_MEDIA_FETCH_TIMEOUT_MS = 20_000;
// Ceiling for ALL downloads combined. The per-attachment timeout alone is not
// enough: 10 attachments could burn 200s of the 5-minute lease before the create
// even starts, and the lease clock starts at the claim. If a second attempt then
// judged the lease stale while this one is still uploading, both would create a
// thread. Budgeting the whole prep well under the lease keeps that impossible.
const SHOWCASE_MEDIA_TOTAL_BUDGET_MS = 60_000;

// Download the showcase media so the featured post owns its copies: Discord CDN
// links carry an expiring signature and render as dead media within days.
// Downloading here (rather than handing URLs to discord.js) keeps the fetch
// bounded — discord.js resolves file URLs with a plain fetch with no timeout,
// which could otherwise outlive the 5-minute publish lease and let a second
// attempt start while the first is still uploading. Returns null when re-upload
// isn't viable, and the caller publishes links instead.
async function prepareShowcaseMedia(message: Message): Promise<AttachmentBuilder[] | null> {
    const attachments = [...message.attachments.values()];
    if (!attachments.length) return [];
    const total = attachments.reduce((sum, att) => sum + (att.size || 0), 0);
    if (total > SHOWCASE_MEDIA_TOTAL_CAP) return null;

    const files: AttachmentBuilder[] = [];
    const deadline = Date.now() + SHOWCASE_MEDIA_TOTAL_BUDGET_MS;
    for (const attachment of attachments) {
        // Give up on re-upload (falling back to links) rather than let the download
        // phase eat into the publish lease.
        const remaining = deadline - Date.now();
        if (remaining <= 0) return null;
        try {
            const response = await fetch(attachment.url, {
                signal: AbortSignal.timeout(Math.min(SHOWCASE_MEDIA_FETCH_TIMEOUT_MS, remaining))
            });
            if (!response.ok) return null;
            const buffer = Buffer.from(await response.arrayBuffer());
            if (!buffer.length || buffer.length > SHOWCASE_MEDIA_TOTAL_CAP) return null;
            files.push(new AttachmentBuilder(buffer, { name: attachment.name || 'showcase' }));
        } catch {
            return null;
        }
    }
    return files;
}

// True when Discord definitively rejected the request, so nothing was created and
// retrying is pointless without a change. Network/timeout/5xx failures are NOT
// definitive: the thread may exist, so those must never release the claim.
function isDefinitiveRejection(error: any): boolean {
    const status = Number(error?.status);
    return Number.isFinite(status) && status >= 400 && status < 500 && status !== 429;
}

// Fetch a showcase's original message, distinguishing "the author deleted it"
// from "we could not read it right now". Only error 10008 proves the message is
// gone; a permission blip or rate limit must not be treated as a deletion, since
// retiring a row is irreversible and forfeits the author's reward.
// True when this forum thread is a showcase the bot itself published. Backed by
// the DB checkpoint (forumThreadId), which is authoritative and cheap — unlike
// thread.ownerId, which discord.js leaves undefined for threads it never saw
// created, and whose absence would make a guard delete a real featured post.
export async function isPublishedShowcaseThread(threadId: string): Promise<boolean> {
    const existing = await prisma.showcasePost
        .findFirst({ where: { forumThreadId: threadId }, select: { messageId: true } })
        .catch(() => null);
    return !!existing;
}

async function fetchShowcaseSource(
    channel: TextChannel,
    messageId: string
): Promise<{ message: Message | null; deleted: boolean }> {
    try {
        const message = await channel.messages.fetch(messageId);
        return { message: message as Message, deleted: false };
    } catch (error: any) {
        return { message: null, deleted: Number(error?.code) === 10008 };
    }
}

export async function maybePublishShowcase(client: Client, message: Message): Promise<boolean> {
    let post = await prisma.showcasePost.findUnique({ where: { messageId: message.id } });
    if (!post && message.author && message.channelId === config.channels.showcase && isAllowedShowcaseMessage(message)) {
        post = await prisma.showcasePost.upsert({
            where: { messageId: message.id },
            update: {},
            create: {
                messageId: message.id,
                channelId: message.channelId,
                authorId: message.author.id,
                title: `Showcase by ${message.author.username}`,
                tagName: 'Nothing'
            }
        });
    }
    const staleBefore = new Date(Date.now() - SHOWCASE_PUBLISH_LEASE_MS);
    const retryingStalePublish = !!post
        && post.status === 'PUBLISHING'
        && !post.forumThreadId
        && post.updatedAt <= staleBefore;
    if (!post || (post.status !== 'VOTING' && !retryingStalePublish)) return false;

    // Lower bound for the orphan-thread scan. Anchored to createdAt, which never
    // moves, NOT to updatedAt: every retry bumps updatedAt (the lease refresh below
    // writes it), so an updatedAt-based window walks forward past the very orphan it
    // exists to find. Once the window has passed it, the scan reports "no thread"
    // with certainty and the next attempt publishes a duplicate. The row cannot
    // predate its own showcase message, so createdAt is always early enough.
    const publishSearchFrom = post.createdAt.getTime();

    const plusCount = await prisma.vote.count({
        where: {
            messageId: message.id,
            channelId: config.channels.showcase,
            value: 1,
            voterId: { not: post.authorId }
        }
    });

    // A post that already holds a claim proved its eligibility when it was made.
    // Re-gating on the live tally would abandon it for good if a voter un-reacted
    // mid-publish: the row can never return to VOTING once a create was attempted,
    // so failing here would strand it in PUBLISHING with its controls disabled.
    if (!retryingStalePublish && plusCount < config.showcase.threshold) return false;

    // Claim the one-way publish side effect before creating the forum thread.
    // A stale PUBLISHING lease is safely retried only after reconciliation below.
    const claimed = retryingStalePublish
        ? await prisma.showcasePost.updateMany({
            where: { messageId: message.id, status: 'PUBLISHING', forumThreadId: null, updatedAt: { lte: staleBefore } },
            data: { updatedAt: new Date() }
        })
        : await prisma.showcasePost.updateMany({
            where: { messageId: message.id, status: 'VOTING' },
            data: { status: 'PUBLISHING' }
        });
    if (claimed.count === 0) return false;

    const forum = await client.channels.fetch(config.channels.betterShowcase).catch(() => null);
    if (!forum || forum.type !== ChannelType.GuildForum) {
        await releasePublishClaim(message.id, retryingStalePublish);
        await sendAdminLog(client, {
            title: 'Showcase publish failed',
            color: '#e74c3c',
            description: forum
                ? `<#${config.channels.betterShowcase}> không phải kênh Forum (type=${forum.type}). Better-showcase phải là Forum Channel.`
                : `Không tìm thấy kênh <#${config.channels.betterShowcase}> (sai ID hoặc Stella thiếu quyền View Channel).`
        });
        return false;
    }

    const forumChannel = forum as ForumChannel;

    // Only a resumed attempt can have left an unrecorded thread behind. A fresh
    // VOTING claim never created one, so skip the scan entirely on the hot path.
    if (retryingStalePublish) {
        const discovery = await findRecentlyPublishedThread(forumChannel, message.channelId, message.id, publishSearchFrom - 60_000);
        if (!discovery.certain) {
            await sendAdminLog(client, {
                title: 'Showcase publish reconciliation deferred',
                color: '#e67e22',
                description: 'Không đọc được danh sách thread của forum (thiếu quyền Read Message History?). Sẽ thử lại ở lần quét sau.',
                fields: [{ name: 'Original', value: messageLink(message.guildId, message.channelId, message.id) }]
            }).catch(() => {});
            return false;
        }
        if (discovery.thread) {
            return await finalizeShowcasePublication(client, message, post, discovery.thread.id, plusCount, 'reconciled');
        }
    }

    // Prefer the author's tag, fall back to "Nothing", then to any tag at all so
    // a forum with Require Tag enabled (or renamed tags) still accepts the post.
    const tag = forumChannel.availableTags.find(t => t.name.toLowerCase() === post.tagName.toLowerCase())
        || forumChannel.availableTags.find(t => t.name.toLowerCase() === 'nothing')
        || forumChannel.availableTags[0];

    const backlink = `[Bài gốc](${messageLink(message.guildId, message.channelId, message.id)})`;
    const header = [`**${post.title}**`, `Tác giả: <@${post.authorId}>`].join('\n');
    // Reserve room for the header and backlink so a long showcase body can never
    // truncate away the author credit or the link back to the original post.
    const bodyBudget = 1900 - header.length - backlink.length - 8;
    const body = (message.content || '').slice(0, Math.max(0, bodyBudget));
    const content = [header, body, backlink].filter(Boolean).join('\n\n');

    // Media is downloaded FIRST, before any create call, so the whole payload is
    // ready in memory and the create itself is one short request. Re-uploading
    // (rather than linking) matters because Discord CDN links carry an expiring
    // signature and would render as dead media on the featured post within days.
    // When re-upload isn't viable, fall back to links in the SAME single create —
    // never a second create attempt, because a create that failed client-side may
    // still have succeeded on Discord and a retry would duplicate the post.
    const mediaFiles = await prepareShowcaseMedia(message);
    const mediaUrls = message.attachments.map(att => att.url);
    const usingLinks = mediaFiles === null;
    // In link mode the URLs also consume the budget, so re-trim the body instead of
    // slicing the joined string — a blind slice would cut off the media links and
    // the backlink, which are the whole point of the fallback.
    const linkBlock = mediaUrls.join('\n');
    const linkBody = (message.content || '').slice(0, Math.max(0, bodyBudget - linkBlock.length - 2));
    const finalContent = usingLinks
        ? [header, linkBody, linkBlock, backlink].filter(Boolean).join('\n\n')
        : content;

    let thread;
    try {
        thread = await forumChannel.threads.create({
            name: post.title.slice(0, 100),
            appliedTags: tag ? [tag.id] : [],
            message: {
                content: finalContent,
                files: mediaFiles ?? [],
                allowedMentions: { users: [post.authorId], roles: [], parse: [] as never[] }
            }
        } as any);
    } catch (error: any) {
        // Only a definitive rejection proves nothing was created; release the claim
        // so a later attempt can retry from scratch. Timeouts and 5xx are ambiguous
        // — the thread may exist — so keep the row PUBLISHING and let the
        // stale-lease path (which scans for an orphan first) resolve it.
        const definitive = isDefinitiveRejection(error);
        if (definitive) await releasePublishClaim(message.id, retryingStalePublish);
        await sendAdminLog(client, {
            title: definitive ? 'Showcase publish failed' : 'Showcase publish không chắc chắn (sẽ tự thử lại)',
            color: '#e74c3c',
            fields: [
                { name: 'User', value: `<@${post.authorId}>`, inline: true },
                { name: 'Votes', value: `${plusCount}`, inline: true },
                { name: 'Error', value: String(error?.message || error).slice(0, 800) },
                { name: 'Original', value: messageLink(message.guildId, message.channelId, message.id) }
            ]
        });
        return false;
    }

    if (usingLinks && mediaUrls.length) {
        await sendAdminLog(client, {
            title: 'Showcase media không tải lại được (đăng dạng link)',
            color: '#e67e22',
            description: 'Ảnh/video quá lớn hoặc tải về lỗi, nên bài featured dùng link CDN (có thể hết hạn).',
            fields: [{ name: 'Original', value: messageLink(message.guildId, message.channelId, message.id) }]
        }).catch(() => {});
    }

    // Checkpoint the thread id first: from here on the side effect exists in
    // Discord, so the row must never be released back to VOTING (that would
    // duplicate the thread). A crash here is repaired by the PUBLISHING+threadId
    // sweep in publishEligibleShowcases.
    const threadRecorded = await prisma.showcasePost.updateMany({
        where: { messageId: message.id, status: 'PUBLISHING' },
        data: { forumThreadId: thread.id }
    });
    if (threadRecorded.count === 0) {
        await sendAdminLog(client, {
            title: 'Showcase forum thread not checkpointed',
            color: '#e74c3c',
            fields: [{ name: 'Original', value: messageLink(message.guildId, message.channelId, message.id) }, { name: 'Forum', value: `<#${thread.id}>` }]
        }).catch(() => {});
        return false;
    }

    return await finalizeShowcasePublication(client, message, post, thread.id, plusCount, 'published');
}

// Flip a claimed post to PUBLISHED and run the one-time side effects. The atomic
// PUBLISHING->PUBLISHED transition is the payout gate: only the caller that wins
// it pays the author, DMs them, and queues the cross-post, so no retry or
// reconciliation can double-credit.
async function finalizeShowcasePublication(
    client: Client,
    message: Message,
    post: { authorId: string; title: string; tagName: string },
    threadId: string,
    plusCount: number,
    mode: 'published' | 'reconciled'
): Promise<boolean> {
    // The status flip and the payout share ONE transaction. Committing the flip
    // first and paying afterwards would lose the reward for good on any crash or DB
    // blip in between: PUBLISHED is terminal, so no sweep or retry revisits the row,
    // and ScoinTransaction has no unique constraint that a later replay could use to
    // tell "already paid" from "never paid". Inside the transaction the reward either
    // lands with the flip or the whole thing rolls back to PUBLISHING and is retried.
    let won = false;
    try {
        await prisma.$transaction(async tx => {
            const finalized = await tx.showcasePost.updateMany({
                where: { messageId: message.id, status: 'PUBLISHING' },
                data: {
                    status: 'PUBLISHED',
                    forumThreadId: threadId,
                    publishedAt: new Date()
                }
            });
            // Another caller already finalized this post. Not an error, and nothing
            // to roll back — just don't run the one-time side effects twice.
            if (finalized.count === 0) return;

            if (config.rewards.showcasePublished > 0) {
                await adjustScoinTx(
                    tx,
                    post.authorId,
                    config.rewards.showcasePublished,
                    `Showcase published #${message.id}`,
                    'showcase:publish',
                    `messageId:${message.id}`
                );
            }
            won = true;
        });
    } catch (error) {
        // Rolled back, so the row is still PUBLISHING and a later tick retries it.
        // Both shapes are swept: with the thread id already recorded it goes through
        // the interrupted-publish pass, and without one through the stale-lease pass,
        // whose orphan scan finds the existing thread instead of creating a second.
        console.error(`Showcase finalize transaction failed for ${message.id}:`, error);
        await sendAdminLog(client, {
            title: 'Showcase finalize failed (sẽ tự thử lại)',
            color: '#e67e22',
            fields: [
                { name: 'User', value: `<@${post.authorId}>`, inline: true },
                { name: 'Error', value: String((error as any)?.message || error).slice(0, 800) },
                { name: 'Forum', value: `<#${threadId}>` }
            ]
        }).catch(() => {});
        return false;
    }

    if (!won) {
        await sendAdminLog(client, {
            title: 'Showcase publish state mismatch',
            color: '#e74c3c',
            fields: [{ name: 'Original', value: messageLink(message.guildId, message.channelId, message.id) }, { name: 'Forum', value: `<#${threadId}>` }]
        }).catch(() => {});
        return false;
    }

    await sendAdminLog(client, {
        title: mode === 'reconciled' ? 'Showcase published (khôi phục sau lỗi)' : 'Showcase published',
        color: '#2ecc71',
        fields: [
            { name: 'User', value: `<@${post.authorId}>`, inline: true },
            { name: 'Votes', value: `${plusCount}`, inline: true },
            { name: 'Tag', value: post.tagName, inline: true },
            { name: 'Forum', value: `<#${threadId}>` },
            { name: 'Original', value: messageLink(message.guildId, message.channelId, message.id) }
        ]
    });

    // Queue an admin-approval Facebook cross-post candidate. No-op (fail-closed)
    // when the feature is disabled or the token/page env vars are unset.
    await queueCrossPostCandidate(client, {
        sourceChannelId: message.channelId,
        sourceMessageId: message.id,
        authorId: post.authorId,
        caption: post.title
    }).catch(() => {});

    const author = await client.users.fetch(post.authorId).catch(() => null);
    await author?.send({
        embeds: [
            new EmbedBuilder()
                .setColor('#2ecc71')
                .setTitle('Showcase của bạn đã được featured')
                .setDescription(`Bài **${post.title}** đã đạt ${plusCount} ${config.ui.emojis.upvote} và được đăng vào <#${threadId}>.`)
                .setTimestamp()
        ]
    }).catch(() => {});
    return true;
}

// Sweep for posts that should be featured but aren't yet. Selection is driven by
// the vote table, not by recency: a post that crossed the threshold weeks ago is
// still picked up, and posts that never reach it are never even considered. That
// keeps recovery independent of how many below-threshold posts pile up in the
// channel, which a fixed newest-N window could not do.
export async function publishEligibleShowcases(client: Client, limit = 25): Promise<number> {
    const staleBefore = new Date(Date.now() - SHOWCASE_PUBLISH_LEASE_MS);
    // A stored thread ID means the forum post exists, so the only thing missing is
    // the finish line. Finalize one row at a time rather than in bulk: the author
    // still needs the payout, the DM and the cross-post queue, and only the atomic
    // PUBLISHING->PUBLISHED transition inside finalizeShowcasePublication can
    // decide who owes them (a bulk updateMany would flip the status and silently
    // swallow the reward).
    const interrupted = await prisma.showcasePost.findMany({
        where: { status: 'PUBLISHING', forumThreadId: { not: null }, updatedAt: { lte: staleBefore } },
        take: 25
    }).catch(() => [] as Awaited<ReturnType<typeof prisma.showcasePost.findMany>>);
    for (const post of interrupted) {
        const sourceChannel = await client.channels.fetch(post.channelId).catch(() => null);
        const source = sourceChannel?.isTextBased()
            ? await fetchShowcaseSource(sourceChannel as TextChannel, post.messageId)
            : { message: null, deleted: false };
        if (!source.message) {
            // Only close the row out when Discord confirms the original is gone —
            // the forum post already exists, so the row must leave PUBLISHING or it
            // is swept forever. A transient read failure retries on the next tick
            // instead, so the author's payout is not silently skipped.
            if (source.deleted) {
                await prisma.showcasePost.updateMany({
                    where: { messageId: post.messageId, status: 'PUBLISHING' },
                    data: { status: 'PUBLISHED', publishedAt: new Date() }
                }).catch(() => {});
            }
            continue;
        }
        const sourceMessage = source.message;
        const plusCount = await prisma.vote.count({
            where: {
                messageId: post.messageId,
                channelId: config.channels.showcase,
                value: 1,
                voterId: { not: post.authorId }
            }
        }).catch(() => 0);
        await finalizeShowcasePublication(client, sourceMessage as Message, post, post.forumThreadId!, plusCount, 'reconciled')
            .catch(error => {
                console.error(`Showcase finalize failed for ${post.messageId}:`, error);
                return false;
            });
    }

    // Message IDs that already have enough distinct non-author upvotes. Grouping
    // in one query means the scan cost tracks eligible posts, not total posts.
    // The threshold is applied in JS rather than via `having`: Prisma requires a
    // `having` aggregate to also appear in the selection, and getting that subtly
    // wrong throws at runtime only — which the catch below would turn into a
    // permanently silent no-op for the whole sweep. Counting client-side is
    // unconditionally correct and the row count here is small.
    const voteGroups = await prisma.vote.groupBy({
        by: ['messageId'],
        where: { channelId: config.channels.showcase, value: 1 },
        _count: { _all: true }
    }).catch(error => {
        console.error('Showcase vote groupBy failed:', error);
        return [] as Array<{ messageId: string; _count: { _all: number } }>;
    });
    const eligibleMessageIds = voteGroups
        .filter(group => (group._count?._all ?? 0) >= config.showcase.threshold)
        .map(group => group.messageId);

    // Deliberately NO early return when eligibleMessageIds is empty. The recovery
    // arm below (stale PUBLISHING rows) is intentionally not vote-gated, so short-
    // circuiting on the vote query would strand a post stuck mid-publish forever:
    // its controls are disabled at that status and its author is never paid. That
    // is exactly the case that arises on a quiet server, or when voters un-react
    // after the claim was taken.
    const posts = await prisma.showcasePost.findMany({
        where: {
            channelId: config.channels.showcase,
            OR: [
                // Not yet claimed: must currently meet the threshold.
                { status: 'VOTING', messageId: { in: eligibleMessageIds } },
                // Already claimed once, so eligibility is settled. Deliberately NOT
                // vote-gated: if a voter un-reacts after the claim, re-gating here
                // would drop the row out of every future scan and strand it in
                // PUBLISHING forever (controls disabled, author unpaid, and possibly
                // an orphan forum thread from the interrupted attempt).
                { status: 'PUBLISHING', forumThreadId: null, updatedAt: { lte: staleBefore } }
            ]
        },
        // Oldest first: a post that has waited longest gets featured first, and a
        // post stuck behind a persistent failure can never starve the others.
        orderBy: { createdAt: 'asc' },
        take: limit
    });
    if (!posts.length) return 0;

    const channel = await client.channels.fetch(config.channels.showcase).catch(() => null);
    if (!channel || !channel.isTextBased()) return 0;

    let published = 0;
    for (const post of posts) {
        // The group count above includes any self-vote, so re-check the real
        // (non-author) tally before spending a publish attempt.
        const plusCount = await prisma.vote.count({
            where: {
                messageId: post.messageId,
                channelId: config.channels.showcase,
                value: 1,
                voterId: { not: post.authorId }
            }
        });
        // Already-claimed rows (status PUBLISHING) skip this gate: they earned the
        // claim earlier and must be allowed to finish even if the tally has since
        // dipped, because nothing can send them back to VOTING.
        if (post.status === 'VOTING' && plusCount < config.showcase.threshold) continue;

        const source = await fetchShowcaseSource(channel as TextChannel, post.messageId);
        if (!source.message) {
            // Retire the row ONLY when Discord confirms the message is gone.
            // A transient read failure leaves it eligible for the next tick.
            if (source.deleted) {
                await prisma.showcasePost.updateMany({
                    where: { messageId: post.messageId, status: { in: ['VOTING', 'PUBLISHING'] } },
                    data: { status: 'SOURCE_DELETED' }
                }).catch(() => {});
            }
            continue;
        }
        const message = source.message;

        // One failure must not abort the sweep for everyone else.
        const ok = await maybePublishShowcase(client, message as Message)
            .catch(error => {
                console.error(`Showcase publish sweep failed for ${post.messageId}:`, error);
                return false;
            });
        if (ok) published++;
    }

    if (published > 0) {
        await sendAdminLog(client, {
            title: 'Eligible showcases published',
            color: '#2ecc71',
            fields: [{ name: 'Published', value: `${published}`, inline: true }]
        });
    }

    return published;
}

// Periodic safety net. Every other timed subsystem (giveaway, trivia, report...)
// owns a scheduler; showcase publishing previously relied solely on live vote
// events plus one pass at boot, so any transient forum/API failure parked a post
// until the next restart. This tick retries them within a minute.
const SHOWCASE_TICK_MS = 60_000;
let showcaseInterval: NodeJS.Timeout | null = null;
let showcaseTickBusy = false;

export function startShowcaseScheduler(client: Client): void {
    if (showcaseInterval) clearInterval(showcaseInterval);
    showcaseInterval = setInterval(async () => {
        if (showcaseTickBusy) return;
        showcaseTickBusy = true;
        try {
            await publishEligibleShowcases(client);
        } catch (error) {
            console.error('Showcase scheduler tick failed:', error);
        } finally {
            showcaseTickBusy = false;
        }
    }, SHOWCASE_TICK_MS);
}
