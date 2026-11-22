import { OpenAbConnectionLostError } from '@/lib/claude-code-preview/openab-acp-errors'
import { RunHandoff } from '@/lib/lifecycle'

export const HANDED_OFF = Symbol('handed-off')
export const HANDED_OFF_TOOL_ERROR =
  'Nuphos restarted before this tool reported back. The agent kept running; its reply continues below.'
export const CONNECTION_LOST_TOOL_ERROR =
  'The connection to the agent dropped before this tool reported back. The agent kept running; its reply continues below once it reconnects.'

/**
 * The runtime keeps an admitted turn running when its transport drops, and the
 * session observer reattaches and carries the rest as an autonomous run. Only
 * a prompt the runtime accepted has that owner; a drop during initialize,
 * session setup, or before admission stays an actionable failure.
 */
export function lostToReattach(error: unknown, signal: AbortSignal): boolean {
  return error instanceof OpenAbConnectionLostError && error.admitted && !signal.aborted
}

/** Settles only when a draining replica lets go of the turn; a user stop still cancels it. */
export function handedOff(signal: AbortSignal): Promise<typeof HANDED_OFF> {
  return new Promise((resolve) => {
    const settle = () => {
      if (signal.reason instanceof RunHandoff) resolve(HANDED_OFF)
    }

    if (signal.aborted) settle()
    else signal.addEventListener('abort', settle, { once: true })
  })
}
