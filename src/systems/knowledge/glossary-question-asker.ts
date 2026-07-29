import { Client, EmbedBuilder, Message, TextChannel } from 'discord.js';
import { config } from '../../config';
import { selectTermsToAsk, markAsked, recordAnswer, teachTerm, normalizeTerm, getPendingTerms } from './glossary-store';

// Asks the community what a word means, and accepts the answer only from members
// holding the trusted role.
//
// The trust gate is the point of this module. If any member could define a term,
// one troll definition would be believed forever and reused in every later
// bulletin — data poisoning that quietly amplifies itself, because the bulletin
// is what gets read to make decisions. Restricting writes to the existing trusted
// role reuses a signal the server already maintains rather than inventing a new one.

// One message for the whole batch, never one per term: five separate pings would
// read as spam in a channel humans are expected to answer in.
export async function askPendingTerms(client: Client, candidates: string[]): Promise<string[]> {
    if (!config.knowledge.enabled) return [];
    if (!candidates.length) return [];

    const terms = await selectTermsToAsk(candidates);
    if (!terms.length) return [];

    const channel = await client.channels.fetch(config.channels.knowledge).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) return [];

    const lines = terms.map(term => `• **${term}**`).join('\n');
    const embed = new EmbedBuilder()
        .setColor('#9b59b6')
        .setTitle('Stella chưa hiểu mấy từ này')
        .setDescription(
            `${lines}\n\n` +
            'Ai có role tin cậy giải thích giúp Stella với. Trả lời theo dạng:\n' +
            '```\ntừ = nghĩa ngắn gọn\n```\n' +
            'Mỗi dòng một từ. Stella chỉ ghi nhận câu trả lời từ người có role tin cậy.'
        )
        .setTimestamp();

    const sent = await (channel as TextChannel).send({ embeds: [embed] }).catch(() => null);
    // Only mark them asked once the question is actually visible — otherwise a
    // failed send would burn the terms' ask budget without anyone seeing them.
    if (!sent) return [];

    await markAsked(terms);
    return terms;
}

// Parse an answer message into (term, meaning) pairs. Accepts `term = meaning`
// and `term: meaning`, one per line, with optional bullet/number prefixes — the
// shapes people actually type when answering a bulleted question.
function parseAnswers(content: string): Array<{ term: string; meaning: string }> {
    const out: Array<{ term: string; meaning: string }> = [];
    for (const line of content.split(/\r?\n/)) {
        const cleaned = line.trim().replace(/^[-*•\d.)\s]+/, '').replace(/\*\*/g, '');
        if (!cleaned) continue;
        const match = cleaned.match(/^(.{1,60}?)\s*[=:]\s*(.+)$/);
        if (!match) continue;
        const term = match[1].trim();
        const meaning = match[2].trim();
        if (!term || !meaning) continue;
        out.push({ term, meaning });
    }
    return out;
}

// Ai được dạy Stella từ mới. Nhiều role, không phải một: server đã có sẵn tín
// hiệu tin cậy riêng cho từng nhóm (mod, member kỳ cựu), và bắt chúng gộp về một
// role là đổi cấu trúc quyền của server chỉ để vừa một tính năng.
//
// Vẫn là cổng chống data-poisoning như cũ, chỉ rộng hơn: một định nghĩa sai sẽ
// được tái dùng ở MỌI bản tin sau, nên danh sách này phải là role người thật cấp
// tay, không bao giờ là "ai cũng được".
function canTeachGlossary(message: Message): boolean {
    const roles = message.member?.roles.cache;
    if (!roles) return false;
    return config.roles.knowledgeTeachers.some(id => id && roles.has(id));
}

// Tin này có đang nói VỚI Stella không: ping trực tiếp, hoặc reply vào tin của
// Stella. Cả hai đều là hành động có ý thức.
//
// Không dùng `mentions.has()` trơn: nó trả true cho cả @everyone và cho ping role
// mà bot tình cờ có — nghĩa là một tin @everyone kèm dấu "=" sẽ thành lời dạy.
// Ping đúng user bot mới tính.
function isAddressedToBot(message: Message): boolean {
    const selfId = message.client.user?.id;
    if (!selfId) return false;
    if (message.mentions.users.has(selfId)) return true;
    // Reply: chỉ tính khi tin được reply là của Stella. `reference` có thể trỏ tới
    // tin đã xoá hoặc ngoài cache, nên đọc từ bản đã resolve — không resolve được
    // thì coi như không phải, vì đoán ở đây là mở cổng quyền cho một điều kiện
    // không kiểm được.
    return message.mentions.repliedUser?.id === selfId;
}

// Handle a message in the knowledge channel. Returns the number of definitions
// stored, so the caller can react to confirm. Any message that isn't a trusted
// answer to a pending question is ignored silently — this runs on every message
// in that channel and must never be chatty.
export async function collectAnswer(message: Message): Promise<number> {
    if (!config.knowledge.enabled) return 0;
    if (message.author.bot) return 0;

    // Hai đường vào, cùng một cổng quyền:
    //   1. viết trong kênh knowledge (đường cũ, nơi Stella đặt câu hỏi)
    //   2. ping Stella hoặc reply tin của Stella ở BẤT KỲ kênh nào
    //
    // Đường 2 là điều Saly yêu cầu, và nó có lý do thật: từ lạ xuất hiện giữa lúc
    // đang chat, không phải lúc người ta rảnh ghé kênh knowledge. Bắt họ đổi kênh
    // là bắt họ nhớ một việc sẽ bị quên.
    //
    // Ping/reply là điều kiện BẮT BUỘC cho đường 2, không phải tiện lợi: thiếu nó
    // thì mọi tin nhắn có dạng "abc = xyz" ở mọi kênh đều thành lời dạy, kể cả khi
    // người ta đang giải thích cho nhau chứ không nói với bot.
    const inKnowledgeChannel = message.channelId === config.channels.knowledge;
    const addressedToBot = isAddressedToBot(message);
    if (!inKnowledgeChannel && !addressedToBot) return 0;

    // Cổng quyền: chỉ role được cấp mới ghi được vào từ điển. Giữ nguyên vị trí
    // TRƯỚC mọi truy vấn DB — đây là chốt chống data-poisoning, không phải bộ lọc
    // cho tiện.
    if (!canTeachGlossary(message)) return 0;

    const pairs = parseAnswers(message.content);
    if (!pairs.length) return 0;

    // Danh sách từ Stella đang chờ trả lời. Chỉ tra MỘT lần cho cả tin, không phải
    // mỗi dòng một lượt.
    const pending = new Set((await getPendingTerms()).map(normalizeTerm));

    let stored = 0;
    for (const { term, meaning } of pairs) {
        const isAnswer = pending.has(normalizeTerm(term));

        // Từ Stella ĐÃ hỏi -> đường trả lời cũ.
        // Từ Stella CHƯA hỏi -> chỉ nhận khi người ta chủ động nhắn thẳng cho bot.
        //
        // Phân biệt này quan trọng: trong kênh knowledge, hai người có role hoàn
        // toàn có thể đang giải thích cho NHAU bằng dạng "abc = xyz". Nhận bừa
        // những dòng đó là để lời trò chuyện tự lọt vào từ điển. Còn ping/reply
        // bot thì không thể là tình cờ.
        const ok = isAnswer
            ? await recordAnswer(term, meaning, message.author.id, message.id)
            : addressedToBot
                ? await teachTerm(term, meaning, message.author.id, message.id)
                : false;
        if (ok) stored++;
    }
    return stored;
}
