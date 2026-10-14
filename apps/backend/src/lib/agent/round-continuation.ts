/**
 * How a turn that still ended paused should be explained to a headless
 * channel's user. Budget pauses reaching here means the continuation ceiling
 * was spent — the work is real but unfinished. Anything else (the stall
 * watchdog, a content filter) means the turn stopped without that guarantee.
 * Callers word it in their own channel's voice.
 */
export type PausedTurnKind = 'budget-exhausted' | 'stalled'

export function pausedTurnKind(pauseReason: string | undefined): PausedTurnKind {
  // A headless turn that hit its wall-clock ceiling is the same shape as a
  // spent budget — real work, cut short — not a stall. Wording it as "stalled"
  // would tell the user nothing went wrong when 45 minutes of work did.
  return pauseReason === 'output-budget' || pauseReason === 'turn-deadline'
    ? 'budget-exhausted'
    : 'stalled'
}
