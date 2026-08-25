import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from '../config';
import {
    ALL_RULE_KEYS,
    getAutomodSettings,
    patchRule,
    RULE_LABEL,
    setAutomodEnabled,
    setExemptChannels,
    setExemptRoles,
    type AutomodRuleKey
} from '../systems/automod/automod-settings';
import { clearStrikes, listRecentStrikes } from '../systems/automod/automod-strikes';

const RULE_CHOICES = ALL_RULE_KEYS.map(key => ({ name: `${key} — ${RULE_LABEL[key]}`, value: key }));

export default {
    data: new SlashCommandBuilder()
        .setName('automod')
        .setDescription('Cấu hình automod (xoá tin vi phạm + báo mod)')
        .addSubcommand(sub => sub.setName('status').setDescription('Xem trạng thái từng luật'))
        .addSubcommand(sub => sub.setName('on').setDescription('Bật automod'))
        .addSubcommand(sub => sub.setName('off').setDescription('Tắt automod (dùng khi cần tạm ngưng)'))
        .addSubcommand(sub =>
            sub.setName('rule')
                .setDescription('Bật/tắt một luật cụ thể')
                .addStringOption(option =>
                    option.setName('rule').setDescription('Luật').setRequired(true).addChoices(...RULE_CHOICES))
                .addBooleanOption(option =>
                    option.setName('enabled').setDescription('true = bật, false = tắt').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('strikes')
                .setDescription('Xem lượt vi phạm gần đây của một người')
                .addUserOption(option => option.setName('user').setDescription('Thành viên').setRequired(true))
                .addBooleanOption(option => option.setName('clear').setDescription('Xoá sạch strike của người này')))
        .addSubcommandGroup(group =>
            group.setName('words')
                .setDescription('Danh sách từ khoá bị cấm')
                .addSubcommand(sub =>
                    sub.setName('add')
                        .setDescription('Thêm từ khoá bị cấm (khớp theo từ, không khớp giữa từ)')
                        .addStringOption(option => option.setName('word').setDescription('Từ khoá').setRequired(true).setMaxLength(60)))
                .addSubcommand(sub =>
                    sub.setName('remove')
                        .setDescription('Bỏ một từ khoá')
                        .addStringOption(option => option.setName('word').setDescription('Từ khoá').setRequired(true).setMaxLength(60)))
                .addSubcommand(sub => sub.setName('list').setDescription('Xem danh sách từ khoá')))
        .addSubcommandGroup(group =>
            group.setName('exempt')
                .setDescription('Miễn trừ automod')
                .addSubcommand(sub =>
                    sub.setName('role')
                        .setDescription('Thêm/bỏ role được miễn automod')
                        .addRoleOption(option => option.setName('role').setDescription('Role').setRequired(true))
                        .addBooleanOption(option => option.setName('add').setDescription('true = thêm, false = bỏ').setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName('channel')
                        .setDescription('Thêm/bỏ kênh được miễn automod')
                        .addChannelOption(option => option.setName('channel').setDescription('Kênh').setRequired(true))
                        .addBooleanOption(option => option.setName('add').setDescription('true = thêm, false = bỏ').setRequired(true))))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        // Kiểm lại quyền trong execute: setDefaultMemberPermissions chỉ là mặc định, admin
        // server tắt được nó trong Server Settings → Integrations.
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Manage Server.`, flags: MessageFlags.Ephemeral });
        }
        if (!interaction.guildId) {
            return interaction.reply({ content: `${emojis.error} Lệnh này chỉ dùng trong server.`, flags: MessageFlags.Ephemeral });
        }

        const guildId = interaction.guildId;
        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (group === 'words') {
            const settings = await getAutomodSettings(guildId);
            const words: string[] = Array.isArray(settings.rules.bannedWords?.words)
                ? [...settings.rules.bannedWords!.words]
                : [];

            if (sub === 'list') {
                return interaction.editReply(
                    words.length
                        ? `${emojis.note} **${words.length}** từ khoá bị cấm:\n\`${words.join('`, `')}\``
                        : `${emojis.note} Chưa có từ khoá nào bị cấm.`
                );
            }

            const word = interaction.options.getString('word', true).trim().toLowerCase();
            if (sub === 'add') {
                if (words.includes(word)) return interaction.editReply(`${emojis.close} \`${word}\` đã có trong danh sách.`);
                words.push(word);
                // Thêm từ đầu tiên thì bật luôn luật: người vừa gõ `/automod words add`
                // rõ ràng muốn nó có hiệu lực, chứ không muốn gõ thêm một lệnh nữa.
                await patchRule(guildId, 'bannedWords', { enabled: true, words });
                return interaction.editReply(`${emojis.success} Đã cấm \`${word}\`. Danh sách hiện có **${words.length}** từ.`);
            }

            const next = words.filter(entry => entry !== word);
            if (next.length === words.length) return interaction.editReply(`${emojis.close} \`${word}\` không có trong danh sách.`);
            await patchRule(guildId, 'bannedWords', { words: next, enabled: next.length > 0 });
            return interaction.editReply(`${emojis.success} Đã bỏ \`${word}\`. Còn **${next.length}** từ.`);
        }

        if (group === 'exempt') {
            const settings = await getAutomodSettings(guildId);
            const add = interaction.options.getBoolean('add', true);

            if (sub === 'role') {
                const role = interaction.options.getRole('role', true);
                const current = new Set(settings.exemptRoleIds);
                add ? current.add(role.id) : current.delete(role.id);
                await setExemptRoles(guildId, [...current]);
                return interaction.editReply(
                    `${emojis.success} ${add ? 'Đã miễn' : 'Đã bỏ miễn'} automod cho <@&${role.id}>. ` +
                    `Hiện miễn **${current.size}** role.`
                );
            }

            const channel = interaction.options.getChannel('channel', true);
            const current = new Set(settings.exemptChannelIds);
            add ? current.add(channel.id) : current.delete(channel.id);
            await setExemptChannels(guildId, [...current]);
            return interaction.editReply(
                `${emojis.success} ${add ? 'Đã miễn' : 'Đã bỏ miễn'} automod ở <#${channel.id}>. ` +
                `Hiện miễn **${current.size}** kênh.`
            );
        }

        if (sub === 'on' || sub === 'off') {
            await setAutomodEnabled(guildId, sub === 'on');
            return interaction.editReply(
                sub === 'on'
                    ? `${emojis.success} Automod đã **bật**.`
                    : `${emojis.appeal} Automod đã **tắt**. Nhớ bật lại bằng \`/automod on\`.`
            );
        }

        if (sub === 'rule') {
            const rule = interaction.options.getString('rule', true) as AutomodRuleKey;
            const enabled = interaction.options.getBoolean('enabled', true);
            await patchRule(guildId, rule, { enabled });
            return interaction.editReply(
                `${emojis.success} Luật **${RULE_LABEL[rule]}** (\`${rule}\`) đã ${enabled ? 'bật' : 'tắt'}.`
            );
        }

        if (sub === 'strikes') {
            const target = interaction.options.getUser('user', true);
            if (interaction.options.getBoolean('clear')) {
                const removed = await clearStrikes(target.id);
                return interaction.editReply(`${emojis.success} Đã xoá **${removed}** strike của ${target}.`);
            }
            const strikes = await listRecentStrikes(target.id);
            if (!strikes.length) return interaction.editReply(`${emojis.note} ${target} chưa có strike nào.`);
            const lines = strikes.map(entry =>
                `• <t:${Math.floor(entry.createdAt.getTime() / 1000)}:R> · **${RULE_LABEL[entry.rule as AutomodRuleKey] || entry.rule}**` +
                (entry.channelId ? ` ở <#${entry.channelId}>` : '')
            );
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#e67e22')
                    .setTitle(`Strike automod · ${target.tag}`)
                    .setDescription(lines.join('\n').slice(0, 4000))
                    .setFooter({ text: `${strikes.length} lượt gần nhất · giữ 7 ngày` })]
            });
        }

        // status
        const settings = await getAutomodSettings(guildId);
        const lines = ALL_RULE_KEYS.map(key => {
            const rule = (settings.rules as any)[key];
            const on = rule?.enabled ? emojis.success : emojis.close;
            const params = Object.entries(rule || {})
                .filter(([name]) => name !== 'enabled')
                .map(([name, value]) => `${name}=${Array.isArray(value) ? `${value.length} mục` : value}`)
                .join(' · ');
            return `${on} \`${key}\` — ${RULE_LABEL[key]}${params ? `\n   ${params}` : ''}`;
        });

        return interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(settings.enabled ? '#2ecc71' : '#95a5a6')
                .setTitle(`Automod · ${settings.enabled ? 'ĐANG BẬT' : 'ĐANG TẮT'}`)
                .setDescription(lines.join('\n').slice(0, 4000))
                .addFields(
                    {
                        name: 'Miễn trừ',
                        value: `Role: ${settings.exemptRoleIds.map(id => `<@&${id}>`).join(', ') || '*không*'}\n` +
                            `Kênh: ${settings.exemptChannelIds.map(id => `<#${id}>`).join(', ') || '*không*'}\n` +
                            'Ai có quyền Manage Messages luôn được miễn.',
                        inline: false
                    },
                    {
                        name: 'Hình phạt',
                        value: `Bot **chỉ xoá tin + báo mod**, không tự timeout. Chạm ` +
                            `${config.automod.escalation.map(tier => tier.strikes).join('/')} lượt ` +
                            `trong ${Math.round(config.automod.strikeWindowMs / 60_000)} phút → cảnh báo kèm nút xử ở <#${config.logs.channelId}>.`,
                        inline: false
                    }
                )]
        });
    }
};
