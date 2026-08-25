import { AttachmentBuilder, TextChannel } from 'discord.js';

// Transcript của một ticket, dạng .txt.
//
// Vì sao .txt chứ không phải embed: một ticket có thể dài hàng trăm tin, mà embed trần
// 4096 ký tự. File thì mở được, tìm được, và lưu lại được — đúng thứ mod cần khi phải
// xem lại một vụ vài tuần sau.

const MAX_FETCH = 500;

export async function buildTranscript(channel: TextChannel, header: string): Promise<AttachmentBuilder> {
    const lines: string[] = [header, '='.repeat(header.length), ''];

    // Lấy theo lô 100 (trần của Discord), ngược từ mới về cũ rồi đảo lại.
    const collected: { createdTimestamp: number; text: string }[] = [];
    let before: string | undefined;

    while (collected.length < MAX_FETCH) {
        const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
        if (!batch || batch.size === 0) break;

        for (const message of batch.values()) {
            const attachments = [...message.attachments.values()].map(file => file.url).join(' ');
            const embeds = message.embeds.length ? ` [${message.embeds.length} embed]` : '';
            collected.push({
                createdTimestamp: message.createdTimestamp,
                text: `[${message.createdAt.toISOString()}] ${message.author.tag}: ` +
                    `${message.content || ''}${embeds}${attachments ? `\n    file: ${attachments}` : ''}`
            });
        }

        before = batch.last()?.id;
        if (batch.size < 100) break;
    }

    collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    lines.push(...collected.map(entry => entry.text));
    if (collected.length >= MAX_FETCH) {
        lines.push('', `-- Chỉ lưu ${MAX_FETCH} tin gần nhất --`);
    }

    return new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), {
        name: `transcript-${channel.name}.txt`
    });
}
