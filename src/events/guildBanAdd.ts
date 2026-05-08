import { Events, GuildBan } from 'discord.js';
import { guardGuildBanAdd } from '../systems/antiRaidManager';

export default {
    name: Events.GuildBanAdd,
    once: false,
    async execute(ban: GuildBan) {
        await guardGuildBanAdd(ban.guild, ban.user.id);
    }
};
