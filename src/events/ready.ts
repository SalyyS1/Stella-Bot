import { Events, Client } from 'discord.js';
import { startMaintenanceScheduler } from '../systems/maintenanceManager';
import { ensureRecentVoteReactions } from '../systems/voteBackfillManager';

export default {
    name: Events.ClientReady,
    once: true,
    async execute(client: Client) {
        console.log(`Ready! Logged in as ${client.user?.tag}`);
        startMaintenanceScheduler(client);
        await ensureRecentVoteReactions(client).catch(error => console.error('Vote self-heal failed:', error));
    },
};
