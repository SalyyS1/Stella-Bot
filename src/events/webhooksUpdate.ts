import { Channel, Events } from 'discord.js';
import { guardWebhookCreate } from '../systems/antiRaidManager';

export default {
    name: Events.WebhooksUpdate,
    once: false,
    async execute(channel: Channel) {
        await guardWebhookCreate(channel);
    }
};
