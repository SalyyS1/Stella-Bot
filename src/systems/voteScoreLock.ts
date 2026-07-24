// PostgreSQL transaction advisory lock shared by vote mutations and score backfills.
// It serializes derived score writes without locking unrelated bot activity.
const VOTE_SCORE_LOCK_KEY = 841_509;

export async function lockVoteScores(tx: any): Promise<void> {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${VOTE_SCORE_LOCK_KEY})`);
}
