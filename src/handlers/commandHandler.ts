import fs from 'fs';
import path from 'path';
import { Client, REST, Routes } from 'discord.js';

export async function loadCommands(client: Client) {
    const commandsPath = path.join(__dirname, '../commands');
    if (!fs.existsSync(commandsPath)) {
        fs.mkdirSync(commandsPath, { recursive: true });
    }
    
    const commandsData = [];
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath).default || require(filePath);
        
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            commandsData.push(command.data.toJSON());
            console.log(`[Loaded] Command: ${command.data.name}`);
        } else {
            console.log(`[Warning] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }

    const token = process.env.BOT_TOKEN;
    const clientId = process.env.CLIENT_ID;
    if (!token) throw new Error('Không tìm thấy BOT_TOKEN trong môi trường.');
    if (!clientId) throw new Error('Không tìm thấy CLIENT_ID trong môi trường.');

    if (commandsData.length > 0) {
        const rest = new REST({ version: '10' }).setToken(token);
        if (process.env.GUILD_ID) {
            console.log(`Bắt đầu đồng bộ ${commandsData.length} lệnh (/) cho Server ID: ${process.env.GUILD_ID} (CẬP NHẬT TỨC THÌ)`);
            await rest.put(
                Routes.applicationGuildCommands(clientId, process.env.GUILD_ID),
                { body: commandsData },
            );
        } else {
            console.log(`Bắt đầu đồng bộ ${commandsData.length} lệnh (/) Toàn Cầu. (CẢNH BÁO: Phải mất đến 1 tiếng để Discord cập nhật hiển thị). Dùng GUILD_ID trong .env để cập nhật ngay!`);
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commandsData },
            );
        }
        console.log(`✅ Đồng bộ lệnh (/) thành công!`);
    }
}
