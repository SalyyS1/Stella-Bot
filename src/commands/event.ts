import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    GuildScheduledEventEntityType,
    GuildScheduledEventPrivacyLevel,
    GuildScheduledEventRecurrenceRuleFrequency,
    GuildScheduledEventRecurrenceRuleWeekday,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import { config } from '../config';
import { parseEventStart } from '../systems/scheduled-events/saigon-time';

// /event — tạo sự kiện có hẹn giờ của chính Discord (Scheduled Event), hiện trên thanh
// "Events" và tự nhắc người bấm quan tâm. Không tự viết scheduler: Discord lo nhắc, lo
// đếm người (userCount), và sự kiện lặp lại hằng tuần có sẵn recurrence_rule.

// Giá trị choice là chữ thường để Discord không đụng; map sang enum của API.
const WEEKDAY_BY_CHOICE: Record<string, GuildScheduledEventRecurrenceRuleWeekday> = {
    monday: GuildScheduledEventRecurrenceRuleWeekday.Monday,
    tuesday: GuildScheduledEventRecurrenceRuleWeekday.Tuesday,
    wednesday: GuildScheduledEventRecurrenceRuleWeekday.Wednesday,
    thursday: GuildScheduledEventRecurrenceRuleWeekday.Thursday,
    friday: GuildScheduledEventRecurrenceRuleWeekday.Friday,
    saturday: GuildScheduledEventRecurrenceRuleWeekday.Saturday,
    sunday: GuildScheduledEventRecurrenceRuleWeekday.Sunday
};

const WEEKDAY_LABEL: Record<string, string> = {
    monday: 'Thứ 2',
    tuesday: 'Thứ 3',
    wednesday: 'Thứ 4',
    thursday: 'Thứ 5',
    friday: 'Thứ 6',
    saturday: 'Thứ 7',
    sunday: 'Chủ nhật'
};

const MAX_DURATION_MINUTES = 24 * 60;

export default {
    data: new SlashCommandBuilder()
        .setName('event')
        .setDescription('Tạo sự kiện hẹn giờ trên thanh Events của Discord')
        .addSubcommand(sub =>
            sub.setName('create')
                .setDescription('Tạo một sự kiện (bảo trì, event, wipe map...)')
                .addStringOption(option =>
                    option.setName('name').setDescription('Tên sự kiện').setRequired(true).setMaxLength(100))
                .addStringOption(option =>
                    option.setName('start')
                        .setDescription('Giờ bắt đầu (giờ VN): HH:MM dd/mm, ví dụ 20:00 10/09')
                        .setRequired(true)
                        .setMaxLength(20))
                .addIntegerOption(option =>
                    option.setName('duration').setDescription('Kéo dài bao nhiêu phút (mặc định 60)')
                        .setMinValue(5).setMaxValue(MAX_DURATION_MINUTES))
                .addStringOption(option =>
                    option.setName('location').setDescription('Ở đâu (mặc định: Discord)').setMaxLength(100))
                .addStringOption(option =>
                    option.setName('description').setDescription('Mô tả').setMaxLength(1000))
                .addStringOption(option =>
                    option.setName('repeat')
                        .setDescription('Lặp lại hằng tuần vào một ngày cố định')
                        .setChoices(
                            { name: 'Thứ 2', value: 'monday' },
                            { name: 'Thứ 3', value: 'tuesday' },
                            { name: 'Thứ 4', value: 'wednesday' },
                            { name: 'Thứ 5', value: 'thursday' },
                            { name: 'Thứ 6', value: 'friday' },
                            { name: 'Thứ 7', value: 'saturday' },
                            { name: 'Chủ nhật', value: 'sunday' }
                        )))
        .addSubcommand(sub => sub.setName('list').setDescription('Sự kiện nào đang hẹn'))
        .addSubcommand(sub =>
            sub.setName('cancel')
                .setDescription('Huỷ một sự kiện')
                .addStringOption(option =>
                    option.setName('name').setDescription('Tên sự kiện (hoặc ID)').setRequired(true).setMaxLength(100)))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),

    async execute(interaction: ChatInputCommandInteraction) {
        const emojis = config.ui.emojis;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageEvents)) {
            return interaction.reply({ content: `${emojis.error} Bạn cần quyền Manage Events.`, flags: MessageFlags.Ephemeral });
        }
        if (!interaction.guild) {
            return interaction.reply({ content: `${emojis.error} Lệnh này chỉ dùng trong server.`, flags: MessageFlags.Ephemeral });
        }

        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (sub === 'list') {
            const events = await interaction.guild.scheduledEvents.fetch();
            const upcoming = [...events.values()]
                .sort((a, b) => (a.scheduledStartTimestamp ?? 0) - (b.scheduledStartTimestamp ?? 0))
                .slice(0, 10);
            if (!upcoming.length) {
                return interaction.editReply(`${emojis.note} Chưa có sự kiện nào. Dùng \`/event create\`.`);
            }
            const lines = upcoming.map(event => {
                const when = event.scheduledStartTimestamp
                    ? `<t:${Math.floor(event.scheduledStartTimestamp / 1000)}:F>`
                    : 'chưa hẹn giờ';
                const repeatNote = event.recurrenceRule ? ' (lặp lại hằng tuần)' : '';
                const place = event.entityMetadata?.location && event.entityMetadata.location !== 'Discord'
                    ? ` — ${event.entityMetadata.location}`
                    : '';
                return `• **${event.name}** — ${when}${repeatNote}${place} — 👥 ${event.userCount ?? 0} quan tâm`;
            });
            return interaction.editReply(`${emojis.note} **${events.size}** sự kiện đang hẹn:\n${lines.join('\n')}`);
        }

        if (sub === 'cancel') {
            const input = interaction.options.getString('name', true).trim().toLowerCase();
            const events = await interaction.guild.scheduledEvents.fetch();
            const target = [...events.values()].find(event =>
                event.id === input || event.name.toLowerCase().includes(input)
            );
            if (!target) {
                return interaction.editReply(`${emojis.close} Không tìm thấy sự kiện khớp tên đó.`);
            }
            await target.delete();
            return interaction.editReply(`${emojis.success} Đã huỷ **${target.name}**.`);
        }

        // create
        const name = interaction.options.getString('name', true);
        const startInput = interaction.options.getString('start', true);
        const duration = interaction.options.getInteger('duration') ?? 60;
        const location = interaction.options.getString('location') ?? 'Discord';
        const description = interaction.options.getString('description');
        const repeat = interaction.options.getString('repeat');

        const start = parseEventStart(startInput);
        if (!start) {
            return interaction.editReply(
                `${emojis.error} Không đọc được giờ. Định dạng: \`HH:MM dd/mm\` (giờ Việt Nam), ví dụ \`20:00 10/09\`.`
            );
        }
        if (start.getTime() <= Date.now()) {
            return interaction.editReply(`${emojis.error} Giờ bắt đầu phải ở tương lai.`);
        }

        const event = await interaction.guild.scheduledEvents.create({
            name,
            description: description ?? undefined,
            privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
            // External: không gắn kênh voice — hợp với bảo trì / wipe map / sự kiện ngoài Discord.
            entityType: GuildScheduledEventEntityType.External,
            scheduledStartTime: start,
            scheduledEndTime: new Date(start.getTime() + duration * 60_000),
            entityMetadata: { location },
            recurrenceRule: repeat
                ? {
                    // discord.js tự đổi startAt sang startTimestamp khi gọi API.
                    startAt: start,
                    frequency: GuildScheduledEventRecurrenceRuleFrequency.Weekly,
                    interval: 1,
                    byWeekday: [WEEKDAY_BY_CHOICE[repeat]]
                }
                : undefined
        });

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(name)
            .setDescription(
                (description ? `${description}\n` : '') +
                `⏰ <t:${Math.floor(start.getTime() / 1000)}:F>\n` +
                `📍 ${location}\n` +
                (repeat ? `🔁 Lặp lại hằng tuần vào ${WEEKDAY_LABEL[repeat]}\n` : '') +
                `-# Hiện trong thanh Events của server; ai bấm Quan tâm sẽ được Discord nhắc.`
            );
        return interaction.editReply({ content: `${emojis.success} Đã tạo sự kiện.`, embeds: [embed] });
    }
};
