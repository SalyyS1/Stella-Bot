import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionsBitField, MessageFlags } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('steal')
        .setDescription('Thiếu Emoji xịn? Bứng ngay emoji từ server khác về nhà mình!')
        .addStringOption(option => 
            option.setName('emoji')
                .setDescription('Paste 1 hoặc nhiều Emoji vào đây (VD: <:em1:1> <:em2:2>)')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuildExpressions),
    
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!interaction.guild) {
            return interaction.editReply('❌ Lệnh này chỉ dùng được trong Server!');
        }

        const rawEmoji = interaction.options.getString('emoji', true);
        const emojiRegex = /<(a?):([a-zA-Z0-9_]+):(\d+)>/g;
        let match;
        const emojisToProcess = [];

        while ((match = emojiRegex.exec(rawEmoji)) !== null) {
            emojisToProcess.push({
                isAnimated: match[1] === 'a',
                name: match[2].replace(/[^a-zA-Z0-9_]/g, ''),
                id: match[3]
            });
        }

        if (emojisToProcess.length === 0) {
            return interaction.editReply('❌ **Sai định dạng Emoji!** Bạn phải dán đúng chuẩn `<:tên:id>` hoặc copy nguyên mẫu emoji custom dán vào.');
        }

        if (emojisToProcess.length > 20) {
            return interaction.editReply('❌ Tham lam! Chôm tối đa 20 cái mỗi lần thôi!');
        }

        let successCount = 0;
        let failedCount = 0;
        let resultMsg = '🎯 **KẾT QUẢ CHÔM CHỈA:**\n```typescript\n';

        for (const target of emojisToProcess) {
            if (target.name.length < 2) target.name = 'emoji_' + target.name;

            const extension = target.isAnimated ? 'gif' : 'png';
            const url = `https://cdn.discordapp.com/emojis/${target.id}.${extension}`;

            try {
                const addedEmoji = await interaction.guild.emojis.create({
                    attachment: url,
                    name: target.name
                });
                successCount++;
                const format = target.isAnimated ? `<a:${addedEmoji.name}:${addedEmoji.id}>` : `<:${addedEmoji.name}:${addedEmoji.id}>`;
                resultMsg += `${target.name}: "${format}",\n`;
            } catch (error: any) {
                failedCount++;
                if (error.code === 30008) {
                    resultMsg += `// ❌ ${target.name}: Bị tạch (Đầy slot Emoji!)\n`;
                    break;
                }
                resultMsg += `// ❌ ${target.name}: Bị tạch (Lỗi file/Quyền)\n`;
            }
        }

        await interaction.editReply({
            content: `Đã xử lý xong! Thành công: **${successCount}** | Thất bại: **${failedCount}**\n\n${resultMsg}\n\`\`\`\n📌 _Copy đoạn code trên dán đè vào \`config.ts\` phần \`emojis\` là xài bốc đầu!_`
        });
    }
};
