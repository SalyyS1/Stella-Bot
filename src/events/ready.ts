import { Events, Client } from 'discord.js';
import { startMaintenanceScheduler } from '../systems/maintenanceManager';
import { ensureRecentVoteReactions } from '../systems/voteBackfillManager';
import { publishEligibleShowcases } from '../systems/showcaseManager';

export default {
    name: Events.ClientReady,
    once: true,
    execute(client: Client) {
        console.log(`Ready! Logged in as ${client.user?.tag}`);
        startMaintenanceScheduler(client);
        ensureRecentVoteReactions(client).catch(error => console.error('Vote reaction self-heal failed:', error));
        publishEligibleShowcases(client).catch(error => console.error('Showcase publish self-heal failed:', error));
    },
};
