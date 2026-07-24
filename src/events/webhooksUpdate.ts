import { Channel, Events } from 'discord.js';
import { guardWebhookUpdate } from '../systems/antiRaidManager';

export default {
    name: Events.WebhooksUpdate,
    once: false,
    async execute(channel: Channel) {
        await guardWebhookUpdate(channel);
    }
};
