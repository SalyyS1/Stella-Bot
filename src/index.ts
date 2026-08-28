import { Client, GatewayIntentBits, Collection, Partials } from 'discord.js';
import * as dotenv from 'dotenv';
import { loadCommands } from './handlers/commandHandler';
import { loadEvents } from './handlers/eventHandler';
import { setupLavalink, startSatelliteMusicBots } from './systems/music';
import { startPanel } from './panel/panel-server';

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
        // Cần cho inviteCreate/inviteDelete: giữ ảnh chụp `uses` luôn mới để lúc
        // member join còn diff ra được ai mời. Riêng việc fetch invite thì cần
        // quyền Manage Server, không phải intent — thiếu quyền sẽ được log rõ.
        GatewayIntentBits.GuildInvites,
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

    // Panel quản trị: mặc định tắt (PANEL_ENABLED). Bọc catch vì panel là phần thêm —
    // port bị chiếm hay web/out chưa build chỉ được làm mất panel, không mất bot.
    try {
        startPanel(client);
    } catch (error) {
        console.error('Panel failed to start:', error);
    }
}

init().catch(error => {
    console.error('Bot startup failed:', error);
    process.exitCode = 1;
});
