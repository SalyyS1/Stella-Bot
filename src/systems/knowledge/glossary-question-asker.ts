import { Client, EmbedBuilder, Message, TextChannel } from 'discord.js';
import { config } from '../../config';
import { selectTermsToAsk, markAsked, recordAnswer, normalizeTerm, getPendingTerms } from './glossary-store';

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

// Handle a message in the knowledge channel. Returns the number of definitions
// stored, so the caller can react to confirm. Any message that isn't a trusted
// answer to a pending question is ignored silently — this runs on every message
// in that channel and must never be chatty.
export async function collectAnswer(message: Message): Promise<number> {
    if (!config.knowledge.enabled) return 0;
    if (message.author.bot) return 0;
    if (message.channelId !== config.channels.knowledge) return 0;

    // The gate: only the trusted role may teach Stella vocabulary.
    const member = message.member;
    if (!member?.roles.cache.has(config.roles.trusted)) return 0;

    const pairs = parseAnswers(message.content);
    if (!pairs.length) return 0;

    // Only accept answers to questions Stella actually asked. Checked up front so
    // a chatty trusted message doesn't cost one DB write per line.
    const pending = new Set((await getPendingTerms()).map(normalizeTerm));
    if (!pending.size) return 0;

    let stored = 0;
    for (const { term, meaning } of pairs) {
        if (!pending.has(normalizeTerm(term))) continue;
        const ok = await recordAnswer(term, meaning, message.author.id, message.id);
        if (ok) stored++;
    }
    return stored;
}
