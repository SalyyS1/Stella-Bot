import {
    AttachmentBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder
} from 'discord.js';
import { config } from '../config';
import { isAiEnabled } from '../systems/aiClient';
import { patchConfigFile, patchFailureMessage, isSupportedConfigName } from '../systems/builder/config-patch-service';
import { reserveConfigSlot, releaseConfigSlot, gateMessage } from '../systems/builder/config-patch-gate';

// /config — upload a server config file, describe the change, get the edited file
// back. The heavy lifting (secret redaction, AI call, restore) lives in
// systems/builder; this file owns only the Discord surface: validation, gating,
// and turning a result into a reply.

// Attachments must come from Discord's own CDN. The URL is supplied by the API
// rather than the user, so this is defense-in-depth — but it costs one check and
// removes any chance of the bot being talked into fetching an arbitrary host.
const ALLOWED_ATTACHMENT_HOSTS = new Set([
    'cdn.discordapp.com',
    'media.discordapp.net'
]);

function isAllowedAttachmentUrl(raw: string): boolean {
    try {
        const url = new URL(raw);
        return url.protocol === 'https:' && ALLOWED_ATTACHMENT_HOSTS.has(url.hostname.toLowerCase());
    } catch {
        return false;
    }
}

// Download the attachment with a hard byte ceiling, measured on the bytes actually
// received rather than on the size Discord reported. The caller already refused
// anything oversized by that reported size; this second check is what holds if the
// two ever disagree. Note it is not a streaming cap: the body is read in full and
// then measured, which is acceptable only because the caller's check keeps the
// realistic worst case at a few hundred KB.
async function downloadText(url: string, maxBytes: number): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
        const res = await fetch(url, { signal: controller.signal, redirect: 'manual' });
        if (!res.ok) return null;
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength > maxBytes) return null;
        return new TextDecoder('utf-8').decode(buffer);
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Nhờ Stella sửa file config server (YAML / properties)')
        .addAttachmentOption(option =>
            option
                .setName('file')
                .setDescription('File config cần sửa (.yml, .yaml, .properties, .conf, .toml, .json)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('yeu-cau')
                .setDescription('Mô tả điều cần sửa, ví dụ: đổi max-players thành 50')
                .setRequired(true)
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!config.configPatch.enabled) {
            return interaction.reply({
                content: `${config.ui.emojis.error} Tính năng sửa config đang tắt.`,
                flags: MessageFlags.Ephemeral
            });
        }
        if (!isAiEnabled()) {
            return interaction.reply({
                content: `${config.ui.emojis.error} Tính năng AI đang tắt.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const attachment = interaction.options.getAttachment('file', true);
        const instruction = interaction.options.getString('yeu-cau', true).trim();

        if (!isSupportedConfigName(attachment.name)) {
            return interaction.reply({
                content: `${config.ui.emojis.error} ${patchFailureMessage('bad-extension')}`,
                flags: MessageFlags.Ephemeral
            });
        }
        // Reject on the reported size before downloading anything — no reason to
        // pull a 50MB file across the wire just to refuse it.
        if (attachment.size > config.configPatch.maxBytes) {
            return interaction.reply({
                content: `${config.ui.emojis.error} File quá lớn (tối đa ${Math.floor(config.configPatch.maxBytes / 1024)} KB).`,
                flags: MessageFlags.Ephemeral
            });
        }
        if (!isAllowedAttachmentUrl(attachment.url)) {
            return interaction.reply({
                content: `${config.ui.emojis.error} Không đọc được file này.`,
                flags: MessageFlags.Ephemeral
            });
        }
        if (instruction.length < 4) {
            return interaction.reply({
                content: `${config.ui.emojis.error} Mô tả yêu cầu rõ hơn một chút nhé.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const gate = reserveConfigSlot(interaction.user.id);
        if (!gate.ok) {
            return interaction.reply({
                content: `${config.ui.emojis.error} ${gateMessage(gate.reason!, gate.retryInSec)}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Ephemeral: a config file can carry infrastructure details even after
        // secrets are redacted, so the result goes only to the person who asked.
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const raw = await downloadText(attachment.url, config.configPatch.maxBytes);
            if (raw === null) {
                return interaction.editReply(`${config.ui.emojis.error} Không tải được file (quá lớn hoặc lỗi mạng).`);
            }

            const result = await patchConfigFile(attachment.name, raw, instruction);
            if (!result.ok) {
                return interaction.editReply(`${config.ui.emojis.error} ${patchFailureMessage(result.reason)}`);
            }

            const embed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setTitle('Config đã sửa')
                .setDescription(
                    `**File:** \`${attachment.name}\`\n` +
                    `**Yêu cầu:** ${instruction.slice(0, 500)}\n\n` +
                    (result.secretsProtected > 0
                        ? `${config.ui.emojis.success} Đã che **${result.secretsProtected}** giá trị bảo mật (mật khẩu/token) trước khi gửi cho AI, và khôi phục lại trong file trả về.`
                        : 'Không phát hiện giá trị bảo mật nào trong file.')
                )
                .setFooter({ text: 'Stella • kiểm tra lại file trước khi dùng trên server thật' })
                .setTimestamp();

            const file = new AttachmentBuilder(Buffer.from(result.content, 'utf-8'), {
                name: attachment.name
            });

            return interaction.editReply({ embeds: [embed], files: [file] });
        } catch (error) {
            console.error('[config] patch command failed:', error);
            return interaction.editReply(`${config.ui.emojis.error} Có lỗi khi sửa config, thử lại sau nhé.`);
        } finally {
            releaseConfigSlot(interaction.user.id);
        }
    }
};
