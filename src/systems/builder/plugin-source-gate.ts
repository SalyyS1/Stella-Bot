import { config } from '../../config';
import { createSlotGate, GateReason } from './ai-slot-gate';

// Rate limiting for /plugin. Mechanics are shared with /config via ai-slot-gate;
// only the limits differ. These are the tightest in the bot: generating a whole
// plugin is the single most expensive call Stella makes.

const gate = createSlotGate({
    cooldownMs: () => config.pluginSource.cooldownMs,
    maxConcurrent: () => config.pluginSource.maxConcurrent,
    busyLabel: 'viết code plugin'
});

export const reservePluginSlot = gate.reserve;
export const releasePluginSlot = gate.release;
export const pluginGateMessage = gate.message;
export type { GateReason };
