import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { config } from '../config';

export default {
    data: new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Tao bang dieu khien giao dich trung tam (Admin)'),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.memberPermissions?.has('Administrator')) {
            return interaction.reply({ content: `${config.ui.emojis.error} Ban khong co quyen su dung lenh nay.`, flags: MessageFlags.Ephemeral });
        }

        const emojis = config.ui.emojis;

        const embed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle('BANG DIEU KHIEN GIAO DICH')
            .setDescription(
                `Chao mung ban den voi trung tam giao dich Stella Studio.\n\n` +
                `> ${emojis.budget} **Yeu Cau Co Phi (Paid)**: Tim nguoi lam viec co tra cong.\n` +
                `> ${emojis.service} **Yeu Cau Ho Tro (Free)**: Xin giup do, tim team, giao luu.\n` +
                `> ${emojis.portfolio} **Dang Thong Tin (Portfolio)**: Show san pham, tim khach hang.\n` +
                `> ${emojis.purpleArrow} **Server Ads**: Quang cao Discord/Minecraft server dung format.`
            )
            .setFooter({ text: 'Stella Studio', iconURL: interaction.client.user?.displayAvatarURL() });

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('panel_paid').setLabel('Yeu Cau (Paid)').setStyle(ButtonStyle.Success).setEmoji(emojis.budget),
            new ButtonBuilder().setCustomId('panel_free').setLabel('Yeu Cau (Free)').setStyle(ButtonStyle.Primary).setEmoji(emojis.service),
            new ButtonBuilder().setCustomId('panel_port').setLabel('Portfolio').setStyle(ButtonStyle.Secondary).setEmoji(emojis.portfolio),
            new ButtonBuilder().setCustomId('panel_serverads').setLabel('Server Ads').setStyle(ButtonStyle.Secondary).setEmoji(emojis.purpleArrow)
        );

        await (interaction.channel as any)?.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: `${emojis.success} Da tao panel thanh cong.`, flags: MessageFlags.Ephemeral });
    }
};
