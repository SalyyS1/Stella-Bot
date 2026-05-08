import { Events, Role } from 'discord.js';
import { guardRoleCreate } from '../systems/antiRaidManager';

export default {
    name: Events.GuildRoleCreate,
    once: false,
    async execute(role: Role) {
        await guardRoleCreate(role);
    }
};
