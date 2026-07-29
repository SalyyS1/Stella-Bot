import {
    AttachmentBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder
} from 'discord.js';
import { config } from '../config';
import { isAiEnabled } from '../systems/aiClient';
import { generatePluginSource, generateFailureMessage } from '../systems/builder/plugin-source-generator';
import { reservePluginSlot, releasePluginSlot, pluginGateMessage } from '../systems/builder/plugin-source-gate';
import { parsePluginFiles, hasRequiredFiles } from '../systems/builder/plugin-source-file-parser';
import {
    buildPluginJar,
    buildFailureMessage,
    isBuildConfigured
} from '../systems/builder/plugin-build-client';

// /plugin — describe a feature, get plugin SOURCE CODE back as a file, and when a
// build repo is configured, a jar built from it.
//
// The source reply is the product; the jar is an extra. Nothing is compiled on this
// machine: the code goes to an ephemeral GitHub runner, so AI-written code never
// executes anywhere holding the bot's token or database. And because a jar carrying
// the studio's name is the studio's responsibility, review is on by default — see
// runBuild below.

// Ship the source to the build runner, then hand the jar to whoever policy says
// may receive it. Never throws: the source reply is already posted by the time this
// runs, and a build problem must not turn a delivered answer into an error message.
async function runBuild(
    interaction: ChatInputCommandInteraction,
    files: Record<string, string>
): Promise<void> {
    const result = await buildPluginJar(files).catch(error => {
        console.error('[plugin] build failed:', error);
        return null;
    });

    if (!result) {
        await interaction
            .followUp(`${config.ui.emojis.error} Build jar lỗi. Mã nguồn ở trên vẫn dùng được.`)
            .catch(() => {});
        return;
    }
    if (!result.ok) {
        await interaction
            .followUp(
                `${config.ui.emojis.error} ${buildFailureMessage(result.reason)}` +
                (result.runUrl ? `\nLog build: ${result.runUrl}` : '')
            )
            .catch(() => {});
        return;
    }

    // GitHub hands artifacts over as a zip and Discord carries it as-is, so nothing
    // here extracts anything — which is also why there is no zip-slip to guard.
    const jar = new AttachmentBuilder(result.zip, { name: 'plugin-jar.zip' });

    if (!config.pluginBuild.requireReview) {
        await interaction
            .followUp({
                content:
                    `${config.ui.emojis.success} Jar build xong.\n` +
                    `${config.ui.emojis.appeal} Code AI viết — thử trên server test trước khi đưa lên server thật.\n` +
                    `Log build: ${result.runUrl}`,
                files: [jar]
            })
            .catch(() => {});
        return;
    }

    // Review bật: jar đi tới owner, KHÔNG tới member. Đây là điểm chốt của cả tính
    // năng — jar do AI viết mà phát dưới tên studio thì trách nhiệm thuộc về Saly,
    // nên phải có người thật xem trước.
    const ownerId = config.report.suggest.ownerUserId;
    if (!ownerId) {
        // Fail closed: review được yêu cầu nhưng không biết gửi cho ai, thì không
        // phát jar cho ai cả. Thà member tự build từ source còn hơn lọt jar chưa duyệt.
        console.error('[plugin] requireReview bật nhưng OWNER_USER_ID rỗng — không phát jar');
        await interaction
            .followUp(
                `${config.ui.emojis.note} Jar đã build xong nhưng đang chờ duyệt. ` +
                'Trong lúc đó bạn dùng mã nguồn ở trên nhé.'
            )
            .catch(() => {});
        return;
    }

    const owner = await interaction.client.users.fetch(ownerId).catch(() => null);
    const sent = owner
        ? await owner
              .send({
                  content:
                      `${config.ui.emojis.note} Jar chờ duyệt — **${interaction.user.tag}** yêu cầu.\n` +
                      `Kênh: <#${interaction.channelId}>\n` +
                      `Log build: ${result.runUrl}\n` +
                      'Duyệt xong thì Saly tự gửi file cho họ.',
                  files: [jar]
              })
              .then(() => true)
              .catch(() => false)
        : false;

    if (!sent) console.error('[plugin] không gửi được jar cho owner để duyệt');

    await interaction
        .followUp(
            `${config.ui.emojis.note} Jar build xong rồi, đang chờ Saly duyệt trước khi gửi. ` +
            'Mã nguồn ở trên bạn đọc/tự build được ngay.'
        )
        .catch(() => {});
}

export default {
    data: new SlashCommandBuilder()
        .setName('plugin')
        .setDescription('Nhờ Stella viết mã nguồn plugin Minecraft (Paper/Spigot)')
        .addStringOption(option =>
            option
                .setName('mo-ta')
                .setDescription('Plugin cần làm gì? Càng cụ thể càng tốt (lệnh gì, ai dùng, hiệu ứng gì)')
                .setRequired(true)
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!config.pluginSource.enabled) {
            return interaction.reply({
                content: `${config.ui.emojis.error} Tính năng viết code plugin đang tắt.`,
                flags: MessageFlags.Ephemeral
            });
        }
        if (!isAiEnabled()) {
            return interaction.reply({
                content: `${config.ui.emojis.error} Tính năng AI đang tắt.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const description = interaction.options.getString('mo-ta', true).trim();
        if (description.length < config.pluginSource.minDescriptionChars) {
            return interaction.reply({
                content: `${config.ui.emojis.error} ${generateFailureMessage('too-short')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        const gate = reservePluginSlot(interaction.user.id);
        if (!gate.ok) {
            return interaction.reply({
                content: `${config.ui.emojis.error} ${pluginGateMessage(gate.reason!, gate.retryInSec)}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Public, unlike /config: generated plugin source carries no server secrets,
        // and leaving it visible lets other members learn from (and correct) it.
        await interaction.deferReply();

        try {
            const result = await generatePluginSource(description);
            if (!result.ok) {
                return interaction.editReply(`${config.ui.emojis.error} ${generateFailureMessage(result.reason)}`);
            }

            // Parsed up front because it decides what to promise the member: with
            // usable files a jar is coming, without them the source is the deliverable.
            const parsed = parsePluginFiles(result.source);
            // A dropped file means the payload is not the source the member can see,
            // so a jar built from it would be missing code while still compiling and
            // still carrying the studio's name. hasRequiredFiles cannot catch this:
            // plugin.yml plus one surviving class satisfies it even when a second
            // class was dropped for size. Refuse the build and say which files went.
            const buildable =
                isBuildConfigured() &&
                hasRequiredFiles(parsed.files) &&
                parsed.skipped.length === 0;

            const embed = new EmbedBuilder()
                .setColor('#3498db')
                .setTitle('Mã nguồn plugin')
                .setDescription(
                    `**Yêu cầu:** ${description.slice(0, 500)}\n\n` +
                    (buildable
                        ? `${config.ui.emojis.note} Đang build thành \`.jar\` trên máy build, chờ vài phút nhé. ` +
                          'Mã nguồn đính kèm sẵn để bạn đọc trước.\n'
                        : `${config.ui.emojis.note} Đây là **mã nguồn**, chưa phải file \`.jar\` — bạn tự build bằng Maven/Gradle ` +
                          '(hướng dẫn ở cuối file).\n') +
                    // Nêu tên file bị bỏ: không nói ra thì member chỉ thấy "không có
                    // jar" mà không biết lý do, và cũng không biết mã nguồn đang thiếu.
                    (parsed.skipped.length
                        ? `${config.ui.emojis.appeal} Không build tự động được vì có file bị bỏ ` +
                          `(${parsed.skipped.slice(0, 5).join(', ')}). File mã nguồn đính kèm vẫn đầy đủ để bạn tự build.\n`
                        : '') +
                    `${config.ui.emojis.appeal} Code do AI viết: **đọc lại trước khi chạy trên server thật**, ` +
                    'đặc biệt là phần quyền (permission) và xử lý dữ liệu người chơi.'
                )
                .setFooter({ text: 'Stella • code AI viết, cần người thật review' })
                .setTimestamp();

            // A whole plugin blows past the 4096-char embed limit, so the code goes
            // back as a file. .md because the model returns several files as labelled
            // markdown blocks, which stays readable in that form.
            const file = new AttachmentBuilder(Buffer.from(result.source, 'utf-8'), {
                name: 'plugin-source.md'
            });

            await interaction.editReply({ embeds: [embed], files: [file] });

            // Source is already delivered, so everything below is a bonus: a build
            // failure must never take the source reply down with it.
            if (!buildable) return;
            // awaited, NOT returned: `return p` inside try/finally runs the finally
            // block without waiting for p, which would free the gate slot while the
            // build is still going and let a second build start alongside it.
            await runBuild(interaction, parsed.files);
        } catch (error) {
            console.error('[plugin] source generation failed:', error);
            return interaction.editReply(`${config.ui.emojis.error} Có lỗi khi viết code, thử lại sau nhé.`);
        } finally {
            releasePluginSlot(interaction.user.id);
        }
    }
};
