import { Client, GatewayIntentBits, Collection, Partials } from 'discord.js';
import * as dotenv from 'dotenv';
import { loadCommands } from './handlers/commandHandler';
import { loadEvents } from './handlers/eventHandler';
import { setupLavalink, startSatelliteMusicBots } from './systems/music';

dotenv.config();

// Mở rộng interface Client để chứa commands
declare module 'discord.js' {
    interface Client {
        commands: Collection<string, any>;
        lavalink?: any;
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
        GatewayIntentBits.GuildVoiceStates,
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
// setupLavalink tu gan listener 'raw' cho client nay (moi bot client mot
// LavalinkManager rieng), khong can forward thu cong o day nua.
setupLavalink(client);

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

    // Bot loa phụ login SAU bot chính và không được làm chết bot chính: thiếu
    // loa phụ chỉ mất khả năng phát song song nhiều kênh voice.
    const satellites = await startSatelliteMusicBots().catch(error => {
        console.error('Satellite music bots failed to start:', error);
        return 0;
    });
    if (satellites) console.log(`[music] ${satellites} bot loa phụ đã sẵn sàng.`);
}

init().catch(error => {
    console.error('Bot startup failed:', error);
    process.exitCode = 1;
});
