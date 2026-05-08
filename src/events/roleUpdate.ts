import { Events, Role } from 'discord.js';
import { guardRoleUpdate } from '../systems/antiRaidManager';

export default {
    name: Events.GuildRoleUpdate,
    once: false,
    async execute(oldRole: Role, newRole: Role) {
        await guardRoleUpdate(oldRole, newRole);
    }
};
