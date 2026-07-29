import { Client, EmbedBuilder, TextChannel, ForumChannel, ChannelType } from 'discord.js';
import { config } from '../../config';

// Posting side of the nhật báo. Lifted from the previous single-file reportManager
// unchanged in behaviour: embeds (4096-char description cap) with long bodies
// split across follow-up embeds so a full bulletin is never truncated.

// Split a long body into <=4096-char pieces, breaking on newlines where possible.
function splitForEmbed(text: string): string[] {
    const LIMIT = 4096;
    const out: string[] = [];
    let rest = text.trim();
    while (rest.length > LIMIT) {
        let cut = rest.lastIndexOf('\n', LIMIT);
        if (cut < LIMIT * 0.5) cut = LIMIT;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut).replace(/^\n+/, '');
    }
    if (rest) out.push(rest);
    return out.length ? out : [''];
}

// Post the bulletin. Creates a thread for a ForumChannel, else sends a message.
// Returns true only when the FIRST chunk landed: that is what the caller uses to
// decide whether today's claim was spent, so a failed follow-up must not report
// success (the report exists, just shorter) and must not report failure either
// (which would re-post the whole thing on the next tick).
export async function postReport(client: Client, period: string, body: string): Promise<boolean> {
    const channel = await client.channels.fetch(config.report.forumChannel).catch(() => null);
    if (!channel) return false;
    const title = `Bản tin Stella — ${period}`;
    const chunks = splitForEmbed(body);
    const footer = 'Stella • Bản tin tổng hợp bằng AI (chat được tóm tắt, không lưu trữ)';
    const makeEmbed = (desc: string, first: boolean) => {
        const e = new EmbedBuilder().setColor('#f1c40f').setDescription(desc).setTimestamp();
        if (first) e.setTitle(title);
        return e.setFooter({ text: footer });
    };

    if (channel.type === ChannelType.GuildForum) {
        const forum = channel as ForumChannel;
        const thread = await forum.threads.create({
            name: title.slice(0, 100),
            message: { embeds: [makeEmbed(chunks[0], true)] }
        }).catch(() => null);
        if (!thread) return false;
        for (const chunk of chunks.slice(1)) {
            await thread.send({ embeds: [makeEmbed(chunk, false)] }).catch(() => {});
        }
        return true;
    }
    if (channel.isTextBased() && 'send' in channel) {
        const sent = await (channel as TextChannel).send({ embeds: [makeEmbed(chunks[0], true)] }).catch(() => null);
        if (!sent) return false;
        for (const chunk of chunks.slice(1)) {
            await (channel as TextChannel).send({ embeds: [makeEmbed(chunk, false)] }).catch(() => {});
        }
        return true;
    }
    return false;
}
