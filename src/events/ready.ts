import { Events, Client } from 'discord.js';
import { startMaintenanceScheduler } from '../systems/maintenanceManager';
import { ensureRecentVoteReactions } from '../systems/voteBackfillManager';
import { startGiveawayScheduler } from '../systems/giveawayManager';
import { initLavalink } from '../systems/musicManager';
import { ensureSkillRoles } from '../systems/skillRoleManager';
import { startReportScheduler } from '../systems/reportManager';
import { reconcilePendingCrossPosts } from '../systems/facebookCrossPostManager';
import { ensureVerifiedRole } from '../systems/freelancerManager';
import { seedWikis } from '../systems/wikiManager';
import { startTriviaScheduler } from '../systems/trivia-scheduler';
import { startWeeklyRewardScheduler } from '../systems/weekly-reward-manager';
import { startBirthdayScheduler } from '../systems/birthday-manager';

export default {
    name: Events.ClientReady,
    once: true,
    async execute(client: Client) {
        console.log(`Ready! Logged in as ${client.user?.tag}`);
        initLavalink(client);
        startMaintenanceScheduler(client);
        startGiveawayScheduler(client);
        startReportScheduler(client);
        startTriviaScheduler(client);
        startWeeklyRewardScheduler(client);
        startBirthdayScheduler(client);
        // Single-guild bot: create/persist skill roles for request routing on the
        // primary guild. Lazy — safe to re-run; reuses existing roles by id/name.
        const guild = client.guilds.cache.first();
        if (guild) {
            await ensureSkillRoles(guild).catch(error => console.error('Skill-role bootstrap failed:', error));
            await ensureVerifiedRole(guild).catch(error => console.error('Verified-role bootstrap failed:', error));
        }
        await ensureRecentVoteReactions(client).catch(error => console.error('Vote self-heal failed:', error));
        // Seed the plugin-wiki catalog (create-if-absent; never overwrites admin edits).
        await seedWikis().catch(error => console.error('Wiki seed failed:', error));
        // Recover any FB cross-post stuck mid-publish across a restart (flags for
        // manual review — never blind re-posts, to avoid duplicate Page posts).
        await reconcilePendingCrossPosts(client).catch(error => console.error('FB cross-post reconcile failed:', error));
    },
};
