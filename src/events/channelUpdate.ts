import { Channel, Events } from 'discord.js';
import { guardChannelUpdate } from '../systems/antiRaidManager';

export default {
    name: Events.ChannelUpdate,
    once: false,
    async execute(oldChannel: Channel, newChannel: Channel) {
        await guardChannelUpdate(oldChannel, newChannel);
    }
};
