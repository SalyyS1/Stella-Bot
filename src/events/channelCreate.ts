import { Events, GuildBasedChannel } from 'discord.js';
import { guardChannelCreate } from '../systems/antiRaidManager';

export default {
    name: Events.ChannelCreate,
    once: false,
    async execute(channel: GuildBasedChannel) {
        await guardChannelCreate(channel);
    }
};
