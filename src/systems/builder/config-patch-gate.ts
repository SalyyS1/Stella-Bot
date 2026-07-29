import { config } from '../../config';
import { createSlotGate, GateReason } from './ai-slot-gate';

// Rate limiting for /config. The mechanics live in ai-slot-gate (shared with
// /plugin); this file only supplies the limits, which are deliberately tighter
// than the Q&A gate's because patching a config makes the model echo an entire
// file back.

const gate = createSlotGate({
    cooldownMs: () => config.configPatch.cooldownMs,
    maxConcurrent: () => config.configPatch.maxConcurrent,
    busyLabel: 'sửa config'
});

export const reserveConfigSlot = gate.reserve;
export const releaseConfigSlot = gate.release;
export const gateMessage = gate.message;
export type { GateReason };
