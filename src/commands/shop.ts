import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { config } from '../config';
import { getScoinBalance } from '../systems/scoinManager';
import { buyColorRole, listOwnedColorKey, buyShopItem, listPurchaseHistory } from '../systems/shop-manager';

// /shop — Scoin shop for buying color roles
//   xem    → view catalog, balance, owned color (ephemeral)
//   mua    → purchase a color role (ephemeral)
export default {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Cửa hàng Scoin — Mua màu tên bằng Scoin')
        .addSubcommand(sub => sub
            .setName('xem')
            .setDescription('Xem danh mục màu sắc và số dư của bạn'))
        .addSubcommand(sub => sub
            .setName('mua')
            .setDescription('Mua màu tên bằng Scoin')
            .addStringOption(option => {
                option
                    .setName('mau')
                    .setDescription('Chọn màu bạn muốn')
                    .setRequired(true);
                // Generate choices from config.shop.colors (max 25, we have 10)
                for (const color of config.shop.colors) {
                    option.addChoices({ name: color.label, value: color.key });
                }
                return option;
            }))
        .addSubcommand(sub => sub
            .setName('vatpham')
            .setDescription('Mua vật phẩm (XP boost...) bằng Scoin')
            .addStringOption(option => {
                option
                    .setName('mon')
                    .setDescription('Chọn vật phẩm')
                    .setRequired(true);
                for (const item of config.shop.items) {
                    option.addChoices({ name: `${item.label} — ${item.price} Scoin`, value: item.key });
                }
                return option;
            }))
        .addSubcommand(sub => sub
            .setName('history')
            .setDescription('Lịch sử mua hàng của bạn')),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const sub = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        const emojis = config.ui.emojis;

        try {
            if (sub === 'xem') {
                // Show catalog, balance, and owned color
                if (!config.shop.enabled) {
                    return interaction.editReply({
                        content: `${emojis.error} Shop hiện đang đóng cửa.`
                    });
                }

                const balance = await getScoinBalance(userId);
                const price = config.shop.colorRolePrice;

                // Build catalog display with hex color swatches
                const catalog = config.shop.colors
                    .map(color => {
                        // Simple text representation of color with label
                        return `**${color.label}** — \`${color.hex}\``;
                    })
                    .join('\n');

                const embed = new EmbedBuilder()
                    .setColor('#9b59b6')
                    .setAuthor({
                        name: `${interaction.user.username} — Shop Màu Tên`,
                        iconURL: interaction.user.displayAvatarURL()
                    })
                    .setTitle('🎨 Cửa Hàng Màu Sắc')
                    .setDescription(
                        `Mua màu tên để nổi bật trong server!\n` +
                        `Giá: **${price.toLocaleString('vi-VN')}** ${emojis.budget} Scoin / màu\n\n` +
                        `**Danh mục màu:**\n${catalog}`
                    )
                    .addFields({
                        name: `${emojis.budget} Số dư của bạn`,
                        value: `**${balance.toLocaleString('vi-VN')}** Scoin`,
                        inline: false
                    })
                    .setFooter({ text: 'Dùng /shop mua để mua màu' })
                    .setTimestamp();

                // Show currently owned color if any
                const member = await interaction.guild?.members.fetch(userId).catch(() => null);
                if (member) {
                    const ownedKey = await listOwnedColorKey(member);
                    if (ownedKey) {
                        const ownedMeta = config.shop.colors.find(c => c.key === ownedKey);
                        if (ownedMeta) {
                            embed.addFields({
                                name: '✨ Màu đang dùng',
                                value: `**${ownedMeta.label}** — \`${ownedMeta.hex}\``,
                                inline: false
                            });
                        }
                    }
                }

                return interaction.editReply({ embeds: [embed] });
            }

            if (sub === 'mua') {
                // Purchase a color role
                if (!config.shop.enabled) {
                    return interaction.editReply({
                        content: `${emojis.error} Shop hiện đang đóng cửa.`
                    });
                }

                const colorKey = interaction.options.getString('mau', true);
                const guild = interaction.guild;

                if (!guild) {
                    return interaction.editReply({
                        content: `${emojis.error} Lệnh này chỉ dùng được trong server.`
                    });
                }

                // Call shop manager to handle purchase
                const successMsg = await buyColorRole(guild, userId, colorKey);

                const colorMeta = config.shop.colors.find(c => c.key === colorKey);
                const embed = new EmbedBuilder()
                    .setColor(colorMeta?.hex as any || '#9b59b6')
                    .setAuthor({
                        name: interaction.user.username,
                        iconURL: interaction.user.displayAvatarURL()
                    })
                    .setTitle(`${emojis.success} Mua thành công!`)
                    .setDescription(
                        successMsg + '\n\n' +
                        `Tên của bạn giờ có màu **${colorMeta?.label}** rồi!`
                    )
                    .setFooter({ text: `Scoin còn lại: ${(await getScoinBalance(userId)).toLocaleString('vi-VN')}` })
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }

            if (sub === 'vatpham') {
                if (!config.shop.enabled) {
                    return interaction.editReply({ content: `${emojis.error} Shop hiện đang đóng cửa.` });
                }
                const itemKey = interaction.options.getString('mon', true);
                const bought = await buyShopItem(userId, itemKey);
                const embed = new EmbedBuilder()
                    .setColor('#9b59b6')
                    .setTitle(`${emojis.success} Đã mua ${bought.label}`)
                    .setDescription(`Hiệu lực đến <t:${Math.floor(bought.expiresAt.getTime() / 1000)}:R>.`)
                    .setFooter({ text: `Scoin còn lại: ${(await getScoinBalance(userId)).toLocaleString('vi-VN')}` })
                    .setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }

            if (sub === 'history') {
                // Chỉ đơn của chính người gọi, và reply đã ephemeral từ deferReply:
                // đơn hàng cho biết ai tiêu gì, đó là chuyện riêng của họ.
                const rows = await listPurchaseHistory(userId);
                if (!rows.length) {
                    return interaction.editReply({
                        content: `${emojis.error} Bạn chưa mua gì ở shop. Xem \`/shop xem\` để bắt đầu.`
                    });
                }
                const labelOf = (key: string) =>
                    config.shop.items.find(i => i.key === key)?.label
                    || config.shop.colors.find(c => c.key === key)?.label
                    || key;
                const lines = rows.map(r =>
                    `• **${labelOf(r.itemKey)}** — ${r.price.toLocaleString('vi-VN')} Scoin · <t:${Math.floor(r.createdAt.getTime() / 1000)}:d>`
                    + (r.status === 'REFUNDED' ? ' *(đã hoàn xu)*' : '')
                );
                const embed = new EmbedBuilder()
                    .setColor('#9b59b6')
                    .setTitle('Lịch sử mua hàng')
                    .setDescription(lines.join('\n'))
                    .setFooter({ text: `${rows.length} đơn gần nhất` })
                    .setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }

        } catch (error) {
            console.error('Shop command error:', error);
            const errorMsg = error instanceof Error
                ? error.message
                : 'Có lỗi xảy ra khi xử lý lệnh shop.';

            return interaction.editReply({
                content: `${emojis.error} ${errorMsg}`
            });
        }
    }
};
