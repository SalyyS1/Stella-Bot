import { MessageFlags } from 'discord.js';

// ============================================================
//  INTERACTION SAFE REPLY — bo qua interaction da het han/da ack
// ============================================================
// 10062 = Unknown interaction (token het han), 40060 = da acknowledged.
// Hai loi nay xay ra binh thuong khi user bam nut cu hoac double click,
// nen khong log de khoi rac console.

function isExpectedInteractionError(error: any) {
    return error?.code === 10062 || error?.code === 40060;
}

export async function safeInteractionReply(interaction: any, payload: any) {
    try {
        if (interaction.replied || interaction.deferred) return await interaction.followUp(payload);
        return await interaction.reply(payload);
    } catch (error: any) {
        if (!isExpectedInteractionError(error)) console.error(error);
        return null;
    }
}

export async function safeDeferEphemeral(interaction: any) {
    if (interaction.deferred || interaction.replied) return true;
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return true;
    } catch (error: any) {
        if (!isExpectedInteractionError(error)) console.error(error);
        return false;
    }
}

export async function safeDeferUpdate(interaction: any) {
    if (interaction.deferred || interaction.replied) return true;
    try {
        await interaction.deferUpdate();
        return true;
    } catch (error: any) {
        if (!isExpectedInteractionError(error)) console.error(error);
        return false;
    }
}
