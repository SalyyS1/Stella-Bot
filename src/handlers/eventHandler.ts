import fs from 'fs';
import path from 'path';
import { Client } from 'discord.js';

export async function loadEvents(client: Client) {
    const eventsPath = path.join(__dirname, '../events');
    if (!fs.existsSync(eventsPath)) {
        fs.mkdirSync(eventsPath, { recursive: true });
    }

    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));

    for (const file of eventFiles) {
        const filePath = path.join(eventsPath, file);
        const event = require(filePath).default || require(filePath);
        
        const execute = (...args: any[]) => {
            Promise.resolve(event.execute(...args, client)).catch(error => {
                console.error(`[EventError] ${event.name}:`, error);
            });
        };
        if (event.once) client.once(event.name, execute);
        else client.on(event.name, execute);
        console.log(`[Loaded] Event: ${event.name}`);
    }
}
