import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, EmbedBuilder } from 'discord.js';
import { config } from '../config';
import { isAiEnabled } from '../systems/aiClient';
import { reserveQaSlot, gateMessage, answerQuestion, splitForDiscord } from '../systems/aiQaManager';

// /ask <question> — AI Q&A usable in any channel. Pings the caller in the answer
// so the reply-ownership check in the Q&A channel works on the next turn.
export default {
    data: new SlashCommandBuilder()
        .setName('ask')
        .setDescription('Hỏi Stella AI một câu (plugin, config, Minecraft...)')
        .addStringOption(o => o.setName('question').setDescription('Câu hỏi của bạn').setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!isAiEnabled()) {
            return interaction.reply({ content: `${config.ui.emojis.error} Tính năng AI đang tắt.`, flags: MessageFlags.Ephemeral });
        }

        const question = interaction.options.getString('question', true);
        // Defer FIRST, then reserve — so there is no awaited gap between reserving
        // the slot and calling answerQuestion (which releases it). A reserve that
        // isn't followed by answerQuestion would leak the slot forever.
        await interaction.deferReply();
        const gate = reserveQaSlot(interaction.user.id);
        if (!gate.ok) {
            return interaction.editReply({ content: gateMessage(gate.reason) }).catch(() => {});
        }
        const answer = await answerQuestion(interaction.user.id, question);
        // Answers can be long (config/skill samples) → embed (4096/desc) + split.
        // First chunk pings the caller so a follow-up reply is attributable to them.
        const chunks = splitForDiscord(answer);
        await interaction.editReply({
            content: `<@${interaction.user.id}>`,
            embeds: [new EmbedBuilder().setColor('#5865F2').setDescription(chunks[0])],
            allowedMentions: { users: [interaction.user.id] }
        }).catch(() => {});
        for (const chunk of chunks.slice(1)) {
            await interaction.followUp({
                embeds: [new EmbedBuilder().setColor('#5865F2').setDescription(chunk)]
            }).catch(() => {});
        }
    }
};
