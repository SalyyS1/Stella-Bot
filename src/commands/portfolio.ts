import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { config } from '../config';
import { getPublishedPortfolio } from '../systems/showcase/portfolio-query';
import { buildPortfolioView } from '../systems/showcase/portfolio-view';

// `/portfolio` — những bài showcase ĐÃ ĐƯỢC DUYỆT của một người.
//
// Lệnh này mỏng có chủ ý: truy vấn ở `systems/showcase/portfolio-query.ts`, embed ở
// `portfolio-view.ts`. Nút phân trang đi qua interactionCreate nên nó phải dùng lại đúng
// hai module đó — nhồi truy vấn vào đây là buộc phải viết lại lần thứ hai cho nút.

export default {
    data: new SlashCommandBuilder()
        .setName('portfolio')
        .setDescription('Xem các bài showcase đã được duyệt của một người')
        .addUserOption(option =>
            option.setName('user').setDescription('Người bạn muốn xem (mặc định là bạn)').setRequired(false)
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();
        const target = interaction.options.getUser('user') || interaction.user;

        try {
            const data = await getPublishedPortfolio(target.id);
            const view = buildPortfolioView(target, interaction.guildId ?? '', data);
            // parse: [] vì tiêu đề bài là chữ người dùng gõ — sẽ có người nhét
            // "@everyone" vào tên tác phẩm để thử.
            await interaction.editReply({ ...view, allowedMentions: { parse: [] } });
        } catch (error) {
            console.error('[portfolio] command failed:', error);
            await interaction.editReply(`${config.ui.emojis.error} Không đọc được portfolio.`).catch(() => {});
        }
    }
};
