import { Events, Client } from 'discord.js';
import { startMaintenanceScheduler } from '../systems/maintenanceManager';
import { ensureRecentVoteReactions } from '../systems/voteBackfillManager';
import { startGiveawayScheduler } from '../systems/giveawayManager';
import { initLavalink } from '../systems/musicManager';
import { ensureSkillRoles } from '../systems/skillRoleManager';
import { startDigestScheduler } from '../systems/digestManager';
import { reconcilePendingCrossPosts } from '../systems/facebookCrossPostManager';
import { ensureVerifiedRole } from '../systems/freelancerManager';

export default {
    name: Events.ClientReady,
    once: true,
    async execute(client: Client) {
        console.log(`Ready! Logged in as ${client.user?.tag}`);
        initLavalink(client);
        startMaintenanceScheduler(client);
        startGiveawayScheduler(client);
        startDigestScheduler(client);
        // Single-guild bot: create/persist skill roles for request routing on the
        // primary guild. Lazy — safe to re-run; reuses existing roles by id/name.
        const guild = client.guilds.cache.first();
        if (guild) {
            await ensureSkillRoles(guild).catch(error => console.error('Skill-role bootstrap failed:', error));
            await ensureVerifiedRole(guild).catch(error => console.error('Verified-role bootstrap failed:', error));
        }
        await ensureRecentVoteReactions(client).catch(error => console.error('Vote self-heal failed:', error));
        // Recover any FB cross-post stuck mid-publish across a restart (flags for
        // manual review — never blind re-posts, to avoid duplicate Page posts).
        await reconcilePendingCrossPosts(client).catch(error => console.error('FB cross-post reconcile failed:', error));
    },
};
