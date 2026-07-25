import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, EmbedBuilder } from 'discord.js';
import { config } from '../config';
import { getFacts, forgetUser, isMemoryEnabled } from '../systems/member-memory-manager';

// /stella — transparency + control over what Stella remembers about you.
//   biết-gì   → list the facts Stella has stored about the caller (ephemeral)
//   quên-tôi  → wipe every stored fact about the caller
// Both are self-service and scoped to the caller only: a user can inspect/erase
// their OWN memory, never anyone else's.
export default {
    data: new SlashCommandBuilder()
        .setName('stella')
        .setDescription('Xem hoặc xoá những gì Stella nhớ về bạn')
        .addSubcommand(sub => sub
            .setName('nho-gi')
            .setDescription('Xem những điều Stella đang nhớ về bạn'))
        .addSubcommand(sub => sub
            .setName('quen-toi')
            .setDescription('Xoá sạch mọi điều Stella nhớ về bạn')),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!isMemoryEnabled()) {
            return interaction.reply({
                content: `${config.ui.emojis.error} Tính năng trí nhớ đang tắt.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const sub = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        if (sub === 'quen-toi') {
            const count = await forgetUser(userId).catch(() => -1);
            if (count < 0) {
                return interaction.reply({
                    content: `${config.ui.emojis.error} Có lỗi khi xoá, thử lại sau nhé.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            return interaction.reply({
                content: `${config.ui.emojis.success} Xong! Stella đã quên sạch **${count}** điều về bạn.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // biết-gì
        const facts = await getFacts(userId).catch(() => []);
        if (!facts.length) {
            return interaction.reply({
                content: `${config.ui.emojis.note} Stella chưa nhớ gì về bạn cả.`,
                flags: MessageFlags.Ephemeral
            });
        }
        const embed = new EmbedBuilder()
            .setColor('#9b59b6')
            .setTitle('🧠 Stella nhớ gì về bạn')
            .setDescription(facts.map((f, i) => `${i + 1}. ${f}`).join('\n'))
            .setFooter({ text: 'Dùng /stella quen-toi để xoá sạch' });
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
