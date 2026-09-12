-- Report thành viên và trạng thái leo thang.
--
-- Bảng mới, không đụng dữ liệu cũ. CREATE IF NOT EXISTS để chạy lại an toàn.
-- Rollback: revert code; bảng bỏ không làm thay đổi các hệ thống hiện có.

CREATE TABLE IF NOT EXISTS "MemberReport" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reportDay" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceUrl" TEXT,
    "countsTowardEscalation" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberReport_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MemberReport"
    ADD COLUMN IF NOT EXISTS "countsTowardEscalation" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS "MemberReport_guildId_reporterId_targetId_reportDay_key"
    ON "MemberReport"("guildId", "reporterId", "targetId", "reportDay");
CREATE INDEX IF NOT EXISTS "MemberReport_guildId_targetId_status_createdAt_idx"
    ON "MemberReport"("guildId", "targetId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "MemberReport_guildId_status_createdAt_idx"
    ON "MemberReport"("guildId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "MemberReport_reporterId_reportDay_idx"
    ON "MemberReport"("reporterId", "reportDay");

CREATE TABLE IF NOT EXISTS "ReportEscalation" (
    "guildId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "lastActionAt" TIMESTAMP(3),
    "pendingAction" TEXT,
    "pendingLevel" INTEGER,
    "pendingToken" TEXT,
    "pendingThroughAt" TIMESTAMP(3),
    "pendingExpiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportEscalation_pkey" PRIMARY KEY ("guildId", "targetId")
);

-- Giữ migration an toàn nếu một lần chạy thử trước đó đã tạo bảng bản cũ.
ALTER TABLE "ReportEscalation"
    ADD COLUMN IF NOT EXISTS "pendingExpiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ReportEscalation_pendingAction_idx"
    ON "ReportEscalation"("pendingAction");
