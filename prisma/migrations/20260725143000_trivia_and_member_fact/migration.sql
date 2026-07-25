-- Trivia auto-game win log (anti-farm: count wins per user per day).
CREATE TABLE IF NOT EXISTS "TriviaWin" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "reward" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TriviaWin_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TriviaWin_userId_idx" ON "TriviaWin"("userId");
CREATE INDEX IF NOT EXISTS "TriviaWin_createdAt_idx" ON "TriviaWin"("createdAt");

-- Member memory: short facts Stella learns about a member (public chat only).
CREATE TABLE IF NOT EXISTS "MemberFact" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "fact" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemberFact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MemberFact_userId_fact_key" ON "MemberFact"("userId", "fact");
CREATE INDEX IF NOT EXISTS "MemberFact_userId_idx" ON "MemberFact"("userId");

-- Foreign keys to User (cascade delete so /stella quên tôi + user cleanup work).
DO $$ BEGIN
    ALTER TABLE "TriviaWin" ADD CONSTRAINT "TriviaWin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "MemberFact" ADD CONSTRAINT "MemberFact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
