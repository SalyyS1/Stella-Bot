import { AttachmentBuilder, Collection, Events, Message, PartialMessage, TextBasedChannel } from 'discord.js';
import { config } from '../config';
import { getBulkDeletedMirrors } from '../systems/logs/message-mirror';
import { buildBulkDeleteLogPayload } from '../systems/logs/message-log-embeds';
import { sendMessageLog } from '../systems/logs/message-log-sender';
import { resolveDeleter } from '../systems/logs/audit-actor-resolver';
import prisma from '../lib/prisma';

export default {
    name: Events.MessageBulkDelete,
    once: false,
    async execute(messages: Collection<string, Message | PartialMessage>, channel: TextBasedChannel) {
        if (!config.logs.enabled) return;
        if (config.logs.ignoreChannelIds.includes(channel.id)) return;

        const ids = [...messages.keys()];
        const mirrors = await getBulkDeletedMirrors(ids);

        // Một embed tổng thay vì N embed: purge 100 tin mà bắn 100 embed thì kênh log
        // bị đẩy trôi hết mọi thứ khác và không ai đọc được gì.
        const counts = new Map<string, number>();
        for (const row of mirrors) counts.set(row.authorId, (counts.get(row.authorId) ?? 0) + 1);
        const topAuthors = [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([authorId, count]) => ({ authorId, count }));

        const transcript = mirrors.length
            ? new AttachmentBuilder(
                Buffer.from(
                    mirrors.map(row =>
                        `[${row.createdAt.toISOString()}] ${row.authorId}: ${row.content}` +
                        (row.attachments ? `\n    (đính kèm: ${row.attachments})` : '')
                    ).join('\n'),
                    'utf8'
                ),
                { name: `purge-${channel.id}-${Date.now()}.txt` }
            )
            : null;

        await prisma.messageMirror.updateMany({
            where: { messageId: { in: ids } },
            data: { deletedAt: new Date() }
        }).catch(() => {});

        await sendMessageLog(channel.client, buildBulkDeleteLogPayload({
            channelId: channel.id,
            count: ids.length,
            executorId: resolveDeleter(channel.id, topAuthors[0]?.authorId ?? ''),
            topAuthors,
            transcript
        }));
    }
};
