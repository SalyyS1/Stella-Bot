import {
    ActionRowBuilder, EmbedBuilder, ModalBuilder, ModalSubmitInteraction,
    TextInputBuilder, TextInputStyle, User
} from 'discord.js';
import { config } from '../../config';
import { getFreelancerStats } from '../freelancerManager';
import {
    getServiceProfile, MAX_HEADLINE, MAX_PRICE_TEXT, saveServiceProfile,
    type ServiceProfile
} from './freelancer-profile';

// Embed và modal của hồ sơ nhận việc, cùng handler cho modal submit.
//
// Tách khỏi `commands/freelancer.ts` vì `interactionCreate` cần dùng lại cả embed lẫn
// handler: nếu chúng nằm trong file command thì event phải import từ `commands/`, mà
// `commands/` là thứ được nạp động theo tên file — chiều phụ thuộc đó ngược.

export const FREELANCER_EDIT_MODAL = 'freelancer_edit_modal';

// Bảng giá lâu không sửa vẫn hiện, nhưng phải nói rõ là cũ. Người xem tin một con số cũ rồi
// vào thương lượng mới là chuyện tệ; thiếu con số chỉ là bất tiện.
const STALE_AFTER_DAYS = 90;

export function buildFreelancerEditModal(existing: ServiceProfile | null): ModalBuilder {
    const headline = new TextInputBuilder()
        .setCustomId('headline')
        .setLabel('Một dòng giới thiệu')
        .setPlaceholder('VD: Build map Minecraft, nhận job vừa và nhỏ')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(MAX_HEADLINE)
        .setRequired(false);
    const priceText = new TextInputBuilder()
        .setCustomId('priceText')
        .setLabel('Bảng giá')
        .setPlaceholder('VD: Build nhà nhỏ 150k / Map event từ 800k / Gấp thì tính thêm')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(MAX_PRICE_TEXT)
        .setRequired(false);

    // Điền sẵn nội dung cũ: không điền thì sửa một dòng phải gõ lại cả bảng giá, và sẽ có
    // người bỏ trống rồi vô tình xoá sạch.
    if (existing?.headline) headline.setValue(existing.headline);
    if (existing?.priceText) priceText.setValue(existing.priceText);

    return new ModalBuilder()
        .setCustomId(FREELANCER_EDIT_MODAL)
        .setTitle('Hồ sơ nhận việc')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(headline),
            new ActionRowBuilder<TextInputBuilder>().addComponents(priceText)
        );
}

export async function buildServiceProfileEmbed(target: User, viewerIsOwner: boolean): Promise<EmbedBuilder> {
    const emojis = config.ui.emojis;
    const profile = await getServiceProfile(target.id);
    // Uy tín lấy lại từ đúng hàm `/profile` đang dùng, không tính lại: hai lệnh nói hai con
    // số khác nhau về cùng một người là mất tin.
    const stats = await getFreelancerStats(target.id);

    const embed = new EmbedBuilder()
        .setColor(config.ui.colors.portfolio)
        .setAuthor({
            name: `Hồ sơ nhận việc — ${target.username}`,
            iconURL: target.displayAvatarURL({ extension: 'png', size: 128 })
        });

    const reputation = stats.avgRating !== null
        ? `**${stats.avgRating.toFixed(1)}★** (${stats.jobCount} job)`
        : '*chưa có đánh giá*';

    if (!profile) {
        embed.setDescription(
            viewerIsOwner
                ? `${emojis.note} Bạn chưa lập hồ sơ nhận việc.\n\n> Gõ \`/freelancer edit\` để thêm một dòng giới thiệu và bảng giá — khách đỡ phải DM hỏi giá từng người.`
                : `${emojis.note} <@${target.id}> chưa lập hồ sơ nhận việc.\n\n> Uy tín: ${reputation}${stats.verified ? ' ✅' : ''}\n> Xem tác phẩm: \`/portfolio\``
        );
        return embed;
    }

    embed.setDescription(
        (profile.openForWork
            ? `${emojis.success} **Đang nhận việc**`
            : `${emojis.close} **Tạm không nhận việc**`) +
        (profile.headline ? `\n${profile.headline}` : '')
    );

    embed.addFields(
        {
            name: 'Bảng giá',
            value: profile.priceText ? `>>> ${profile.priceText}` : '*chưa ghi bảng giá*',
            inline: false
        },
        {
            name: 'Uy tín',
            value:
                `> ${emojis.star} ${reputation}${stats.verified ? ' ✅' : ''}\n` +
                `> Tác phẩm đã duyệt: \`/portfolio\``,
            inline: false
        }
    );

    const ageDays = (Date.now() - profile.updatedAt.getTime()) / 86_400_000;
    if (ageDays > STALE_AFTER_DAYS) {
        embed.addFields({
            name: 'Lưu ý',
            value: `> Bảng giá này đã **${Math.round(ageDays)} ngày** không cập nhật — nên hỏi lại trước khi chốt.`,
            inline: false
        });
    }

    return embed.setFooter({ text: 'Cập nhật lần cuối' }).setTimestamp(profile.updatedAt);
}

/**
 * Modal submit của `/freelancer edit`. Chỉ ghi hồ sơ của CHÍNH người submit —
 * `interaction.user.id`, không đọc id từ customId, nên không có đường sửa hộ người khác.
 *
 * Interaction phải được defer trước bởi phía gọi (ephemeral): nội dung bảng giá là chuyện
 * riêng giữa họ và khách, không cần cả kênh thấy lúc họ sửa.
 */
export async function handleFreelancerEditModal(
    interaction: ModalSubmitInteraction,
    readField: (name: string) => string | null
): Promise<void> {
    const saved = await saveServiceProfile(interaction.user.id, {
        headline: readField('headline'),
        priceText: readField('priceText')
    });
    if (!saved) {
        await interaction.editReply(`${config.ui.emojis.error} Không lưu được hồ sơ, thử lại sau nha.`).catch(() => {});
        return;
    }
    const embed = await buildServiceProfileEmbed(interaction.user, true);
    await interaction.editReply({
        content: `${config.ui.emojis.success} Đã lưu hồ sơ nhận việc.`,
        embeds: [embed],
        // parse: [] vì headline và bảng giá là chữ người dùng gõ — sẽ có người nhét
        // "@everyone" vào bảng giá để thử.
        allowedMentions: { parse: [] }
    }).catch(() => {});
}
