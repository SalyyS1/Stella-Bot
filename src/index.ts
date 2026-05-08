import { Client, GatewayIntentBits, Collection, Partials } from 'discord.js';
import * as dotenv from 'dotenv';
import { loadCommands } from './handlers/commandHandler';
import { loadEvents } from './handlers/eventHandler';

dotenv.config();

// Mở rộng interface Client để chứa commands
declare module 'discord.js' {
    interface Client {
        commands: Collection<string, any>;
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [
        Partials.Message,
        Partials.Reaction,
        Partials.User,
    ],
    allowedMentions: {
        parse: ['users', 'roles'],
        repliedUser: false
    }
});

client.commands = new Collection();

client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', reason => {
    console.error('Unhandled rejection:', reason);
});

async function init() {
    await loadCommands(client);
    await loadEvents(client);
    
    await client.login(process.env.BOT_TOKEN);
}

init();
