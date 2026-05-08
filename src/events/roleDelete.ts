import { Events, Role } from 'discord.js';
import { guardRoleDelete } from '../systems/antiRaidManager';

export default {
    name: Events.GuildRoleDelete,
    once: false,
    async execute(role: Role) {
        await guardRoleDelete(role);
    }
};
