import { AttachmentBuilder, Client, EmbedBuilder, TextChannel, ForumChannel, ChannelType } from 'discord.js';
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
// `images` (tuỳ chọn) là các TRANG ẢNH tờ báo: trang 1 hiển thị trên embed đầu,
// các trang sau thành gallery attachment ngay dưới — chỉ là phụ kiện, thiếu ảnh
// thì bản tin chữ vẫn đăng y như cũ.
// `title` (tuỳ chọn) ghi đè tiêu đề thread — bài tuần dùng để đánh dấu "SỐ ĐẶC BIỆT";
// không truyền thì giữ mặc định "Bản tin Stella — <period>" cho bài ngày.
// Returns true only when the FIRST chunk landed: that is what the caller uses to
// decide whether today's claim was spent, so a failed follow-up must not report
// success (the report exists, just shorter) and must not report failure either
// (which would re-post the whole thing on the next tick).
export async function postReport(
    client: Client,
    period: string,
    body: string,
    images?: Buffer[],
    title?: string
): Promise<boolean> {
    const channel = await client.channels.fetch(config.report.forumChannel).catch(() => null);
    if (!channel) return false;
    const threadTitle = title ?? `Bản tin Stella — ${period}`;
    const chunks = splitForEmbed(body);
    const footer = 'Stella • Bản tin tổng hợp bằng AI (chat được tóm tắt, không lưu trữ)';
    const attachments = images
        ? images.map((img, i) => new AttachmentBuilder(img, { name: `newspaper-${i + 1}.png` }))
        : [];
    const makeEmbed = (desc: string, first: boolean) => {
        const e = new EmbedBuilder().setColor('#f1c40f').setDescription(desc).setTimestamp();
        if (first) e.setTitle(threadTitle);
        // Trang 1 đại diện cho bài trên embed; trang sau nằm trong files (gallery).
        if (first && attachments.length) e.setImage('attachment://newspaper-1.png');
        return e.setFooter({ text: footer });
    };
    const files = attachments.length ? attachments : undefined;
    // Bản tin do AI viết từ chat của thành viên, nên bất kỳ chuỗi <@id> hay
    // @everyone lọt vào đó đều là nội dung người dùng ảnh hưởng được. Không set
    // cái này thì mỗi tối bot có thể ping thật một loạt người từ chính chữ nó vừa
    // sinh ra. Bản tin cần được ĐỌC, không cần đánh thức ai.
    const allowedMentions = { parse: [] as never[] };

    if (channel.type === ChannelType.GuildForum) {
        const forum = channel as ForumChannel;
        const thread = await forum.threads.create({
            name: threadTitle.slice(0, 100),
            message: { embeds: [makeEmbed(chunks[0], true)], files, allowedMentions }
        }).catch(() => null);
        if (!thread) return false;
        for (const chunk of chunks.slice(1)) {
            await thread.send({ embeds: [makeEmbed(chunk, false)], allowedMentions }).catch(() => {});
        }
        return true;
    }
    if (channel.isTextBased() && 'send' in channel) {
        const sent = await (channel as TextChannel).send({
            embeds: [makeEmbed(chunks[0], true)],
            files,
            allowedMentions
        }).catch(() => null);
        if (!sent) return false;
        for (const chunk of chunks.slice(1)) {
            await (channel as TextChannel).send({ embeds: [makeEmbed(chunk, false)], allowedMentions }).catch(() => {});
        }
        return true;
    }
    return false;
}
