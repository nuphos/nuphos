/**
 * Frames the agent produces only once the turn runs: its text, its reasoning
 * and its tool calls. After any of them, restarting the chat request from
 * message zero runs the turn again, repeating its answer and any side effect
 * of a tool it started, so the turn's own outcome must stand.
 */
export function frameShowsTurnRan(frame: unknown): boolean {
  if (!frame || typeof frame !== 'object') return false
  const type = (frame as { type?: unknown }).type

  return typeof type === 'string' && /^(text|reasoning|tool)-/u.test(type)
}

export function mayRestartFreshAfterStreamError(args: {
  explicitResume: boolean
  turnRan: boolean
}): boolean {
  return !args.explicitResume && !args.turnRan
}
