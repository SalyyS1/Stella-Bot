import { Events, Client } from 'discord.js';
import { startMaintenanceScheduler } from '../systems/maintenanceManager';

export default {
    name: Events.ClientReady,
    once: true,
    execute(client: Client) {
        console.log(`Ready! Logged in as ${client.user?.tag}`);
        startMaintenanceScheduler(client);
    },
};
