import { Events, Client } from 'discord.js';
import { startMaintenanceScheduler } from '../systems/maintenanceManager';
import { ensureRecentVoteReactions } from '../systems/voteBackfillManager';
import { startGiveawayScheduler } from '../systems/giveawayManager';
import { initLavalink } from '../systems/musicManager';

export default {
    name: Events.ClientReady,
    once: true,
    async execute(client: Client) {
        console.log(`Ready! Logged in as ${client.user?.tag}`);
        initLavalink(client);
        startMaintenanceScheduler(client);
        startGiveawayScheduler(client);
        await ensureRecentVoteReactions(client).catch(error => console.error('Vote self-heal failed:', error));
    },
};
