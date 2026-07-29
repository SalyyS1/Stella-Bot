// Nhật báo (daily community bulletin). The implementation lives in
// src/systems/report/*: the single-file version outgrew the 200-line budget once
// the report became map-reduce (3h chunks summarized into a daily bulletin).
//
// This file stays as the public entry point so existing callers keep working:
//   events/ready.ts       -> startReportScheduler
//   commands/maintenance.ts -> runReport
export {
    runReport,
    runChunk,
    startReportScheduler,
    reportChunkStatus
} from './report/report-scheduler';
export type { ReportOutcome, ChunkOutcome } from './report/report-scheduler';
