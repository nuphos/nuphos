/**
 * Frames that mean a server-side or client-side tool may already have begun.
 * Once any of these has crossed the wire, restarting the whole chat request
 * from message zero can repeat an external side effect. Be conservative: an
 * input-available frame is enough even if the result frame never arrives.
 */
export function frameMayHaveStartedToolExecution(frame: unknown): boolean {
  if (!frame || typeof frame !== 'object') return false
  const type = (frame as { type?: unknown }).type

  return (
    type === 'tool-input-available' ||
    type === 'tool-output-available' ||
    type === 'tool-output-error' ||
    type === 'tool-approval-request'
  )
}

export function mayRestartFreshAfterStreamError(args: {
  explicitResume: boolean
  toolExecutionMayHaveStarted: boolean
}): boolean {
  return !args.explicitResume && !args.toolExecutionMayHaveStarted
}
