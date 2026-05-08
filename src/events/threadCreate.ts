import { Events, ThreadChannel } from 'discord.js';
import { config } from '../config';
import { sendAdminLog } from '../utils/adminLog';

export default {
    name: Events.ThreadCreate,
    once: false,
    async execute(thread: ThreadChannel) {
        if (thread.parentId !== config.channels.betterShowcase) return;
        if (thread.ownerId === thread.client.user?.id) return;

        const guild = thread.guild;
        const owner = thread.ownerId ? await guild.members.fetch(thread.ownerId).catch(() => null) : null;
        if (owner?.permissions.has('Administrator')) return;

        await sendAdminLog(thread.client, {
            title: 'Unauthorized better-showcase thread deleted',
            color: '#e74c3c',
            fields: [
                { name: 'User', value: thread.ownerId ? `<@${thread.ownerId}>` : 'Unknown', inline: true },
                { name: 'Thread', value: thread.name || thread.id, inline: true }
            ]
        }).catch(() => {});

        if (thread.ownerId) {
            const user = await thread.client.users.fetch(thread.ownerId).catch(() => null);
            await user?.send('Bài trong better-showcase chỉ được đăng tự động sau khi showcase đạt đủ vote. Hãy đăng bài ở kênh showcase trước nhé.').catch(() => {});
        }

        await thread.delete('Unauthorized direct better-showcase post').catch(() => {});
    }
};
