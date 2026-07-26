import { Client, EmbedBuilder, Message, TextBasedChannel } from 'discord.js';
import { config } from '../config';
import prisma from '../lib/prisma';
import { adjustScoin } from './scoinManager';
import { recordQuestProgress } from './quest-manager';
import questionBank from '../data/trivia-questions.json';

// Auto-trivia game. Stella posts a Minecraft quiz to the chat channel a few times
// a day (scheduler owns the timing); the FIRST correct answer wins Scoin, capped
// per user per day to blunt farming. One question open at a time. The open
// question lives in RAM only — losing it on restart is fine for a casual game;
// the scheduler posts a fresh one later.

interface TriviaQuestion {
    q: string;
    answers: string[];  // accepted variants; compared case/diacritic-insensitively
    hint?: string;
}

interface ActiveTrivia {
    question: TriviaQuestion;
    index: number;      // position in the bank — used as questionId in the reward metadata
    postedAt: number;
    channelId: string;
}

const bank = questionBank as TriviaQuestion[];
let active: ActiveTrivia | null = null;
// Guards the read-check-then-reward path against two near-simultaneous correct
// answers both being credited as "first". Cleared once the winner is settled.
let settling = false;

// Normalize an answer for comparison: lowercase, strip Vietnamese diacritics,
// collapse whitespace, drop trailing punctuation. Makes "Con Creeper!" match "creeper".
function normalize(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')  // strip combining diacritics
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9\s]/g, ' ')     // punctuation → space
        .replace(/\s+/g, ' ')
        .trim();
}

function isCorrect(guess: string, answers: string[]): boolean {
    const g = normalize(guess);
    if (!g) return false;
    return answers.some(a => normalize(a) === g);
}

// Start-of-today in local (Asia/Saigon) terms, as a Date, for the per-day cap query.
// The host runs in Asia/Saigon so a plain local midnight is correct here.
function startOfToday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

async function winsToday(userId: string): Promise<number> {
    return prisma.scoinTransaction.count({
        where: { userId, source: 'trivia:win', createdAt: { gte: startOfToday() } }
    });
}

export function hasActiveTrivia(): boolean {
    return active !== null;
}

// Post a fresh random question to the chat channel. No-op if one is already open
// (only one question at a time) or the channel can't be resolved.
export async function postTrivia(client: Client): Promise<void> {
    if (active) return;
    const index = Math.floor(Math.random() * bank.length);
    const question = bank[index];

    const channel = await client.channels.fetch(config.trivia.channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !channel.isSendable()) return;

    const embed = new EmbedBuilder()
        .setColor('#9b59b6')
        .setTitle('🎮 Đố vui Minecraft')
        .setDescription(`${question.q}\n\n*Trả lời thẳng vào chat nhé — ai đúng ĐẦU TIÊN được **${config.trivia.reward} Scoin**!*`)
        .setFooter({ text: `Stella • Trả lời trong ${Math.round(config.trivia.answerWindowMs / 1000)}s` });

    const sent = await channel.send({ embeds: [embed] }).catch(() => null);
    if (!sent) return;
    active = { question, index, postedAt: Date.now(), channelId: channel.id };
}

// Called from messageCreate for messages in the chat channel. Returns true if the
// message was a winning answer (so the caller can skip re-processing), false
// otherwise (wrong guess, no active question, or off-channel) — chat still flows
// through XP either way.
export async function handleTriviaAnswer(message: Message): Promise<boolean> {
    if (!active) return false;
    if (message.channelId !== active.channelId) return false;
    if (!isCorrect(message.content, active.question.answers)) return false;

    // Claim the win synchronously so a burst of correct answers can't double-pay.
    if (settling) return false;
    settling = true;
    const claimed = active;
    active = null;

    try {
        // Quest "trivia" counts any claimed correct answer, even past the daily
        // Scoin cap — the quest rewards participation, not the trivia payout.
        recordQuestProgress(message.author.id, 'trivia').catch(() => {});
        const already = await winsToday(message.author.id);
        if (already >= config.trivia.maxWinsPerDay) {
            await message.reply(
                `${config.ui.emojis.success} Đúng rồi đó! Mà bạn hết lượt thưởng Scoin hôm nay rồi (tối đa ${config.trivia.maxWinsPerDay} lần/ngày), để dành mai nhé 😉`
            ).catch(() => {});
            return true;
        }

        await adjustScoin(
            message.author.id,
            config.trivia.reward,
            'Trivia win',
            'trivia:win',
            `q:${claimed.index}`
        );
        await message.reply(
            `${config.ui.emojis.success} Chính xác! **+${config.trivia.reward} Scoin** cho <@${message.author.id}> 🎉`
        ).catch(() => {});
        return true;
    } catch (error) {
        console.error('Trivia reward failed:', error);
        return true;
    } finally {
        settling = false;
    }
}

// Close an open question that nobody answered in time, announcing the answer.
// Called each scheduler tick.
export async function expireTrivia(client: Client): Promise<void> {
    if (!active) return;
    if (Date.now() - active.postedAt < config.trivia.answerWindowMs) return;

    const expired = active;
    active = null;
    const channel = await client.channels.fetch(expired.channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !channel.isSendable()) return;
    await channel.send({
        embeds: [new EmbedBuilder()
            .setColor('#95a5a6')
            .setDescription(`⏰ Hết giờ! Đáp án là: **${expired.question.answers[0]}**. Chờ câu tiếp theo nhé!`)]
    }).catch(() => {});
}
