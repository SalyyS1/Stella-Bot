import { Channel, Events } from 'discord.js';
import { guardChannelDelete } from '../systems/antiRaidManager';

export default {
    name: Events.ChannelDelete,
    once: false,
    async execute(channel: Channel) {
        await guardChannelDelete(channel);
    }
};
