import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from '../config';
import { deleteTag, getTag, invalidateTagCache, listTags, setTrigger, upsertTag } from '../systems/utility/tag-store';

export default {
    data: new SlashCommandBuilder()
        .setName('tag')
        .setDescription('Câu trả lời soạn sẵn (thay tag Carl-bot / custom command Dyno)')
        .addSubcommand(sub =>
            sub.setName('show')
                .setDescription('Gửi một tag ra kênh')
                .addStringOption(option => option.setName('name').setDescription('Tên tag').setRequired(true).setMaxLength(60)))
        .addSubcommand(sub => sub.setName('list').setDescription('Danh sách tag'))
        .addSubcommand(sub =>
            sub.setName('create')
                .setDescription('Tạo hoặc sửa tag')
                .addStringOption(option => option.setName('name').setDescription('Tên tag').setRequired(true).setMaxLength(60))
                .addStringOption(option => option.setName('content').setDescription('Nội dung').setRequired(true).setMaxLength(1500)))
        .addSubcommand(sub =>
            sub.setName('delete')
                .setDescription('Xoá tag')
                .addStringOption(option => option.setName('name').setDescription('Tên tag').setRequired(true).setMaxLength(60)))
        .addSubcommand(sub =>
            sub.setName('trigger')
                .setDescription('Đặt từ khoá tự trả lời cho tag (bỏ trống = tắt)')
                .addStringOption(option => option.setName('name').setDescription('Tên tag').setRequired(true).setMaxLength(60))
                .addStringOption(option => option.setName('keyword').setDescription('Từ khoá; bỏ trống để tắt').setMaxLength(60))),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        const sub = interaction.options.getSubcommand();
        const canManage = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ?? false;

        if (sub === 'show') {
            const tag = await getTag(interaction.options.getString('name', true));
            if (!tag) return interaction.reply({ content: `${emojis.error} Không có tag đó.`, flags: MessageFlags.Ephemeral });
            // Nội dung do admin nhập nhưng bot là người gửi → chặn mọi mention, nếu không
            // `/tag create` thành công cụ ping @everyone.
            return interaction.reply({ content: tag.content.slice(0, 2000), allowedMentions: { parse: [] } });
        }

        if (sub === 'list') {
            const tags = await listTags();
            if (!tags.length) return interaction.reply({ content: `${emojis.note} Chưa có tag nào.`, flags: MessageFlags.Ephemeral });
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle(`Tag (${tags.length})`)
                    .setDescription(tags.map(tag =>
                        `\`${tag.name}\` · ${tag.uses} lượt${tag.autoTrigger ? ` · tự trả lời khi có "${tag.autoTrigger}"` : ''}`
                    ).join('\n').slice(0, 4000))],
                flags: MessageFlags.Ephemeral
            });
        }

        if (!canManage) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Manage Messages để sửa tag.`, flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const name = interaction.options.getString('name', true).trim().toLowerCase();

        if (sub === 'create') {
            const content = interaction.options.getString('content', true);
            if (content.length > config.utility.tags.maxContentLength) {
                return interaction.editReply(`${emojis.error} Nội dung tối đa ${config.utility.tags.maxContentLength} ký tự.`);
            }
            await upsertTag({ name, content, createdBy: interaction.user.id });
            invalidateTagCache();
            return interaction.editReply(`${emojis.success} Đã lưu tag \`${name}\`. Gọi bằng \`/tag show\` hoặc \`!tag ${name}\`.`);
        }

        if (sub === 'delete') {
            const removed = await deleteTag(name).catch(() => null);
            invalidateTagCache();
            return interaction.editReply(removed ? `${emojis.success} Đã xoá tag \`${name}\`.` : `${emojis.error} Không có tag đó.`);
        }

        const keyword = interaction.options.getString('keyword');
        const tag = await getTag(name);
        if (!tag) return interaction.editReply(`${emojis.error} Không có tag đó.`);
        await setTrigger(name, keyword);
        invalidateTagCache();
        return interaction.editReply(
            keyword
                ? `${emojis.success} Tag \`${name}\` sẽ tự trả lời khi ai đó nhắc **"${keyword}"** ` +
                  `(khớp theo từ, nhịp tối thiểu ${Math.round(config.utility.tags.autoCooldownMs / 1000)}s mỗi kênh).`
                : `${emojis.success} Đã tắt tự trả lời cho tag \`${name}\`.`
        );
    }
};
