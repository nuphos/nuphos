// The chat switch under way, for the `chat_switch` event: started wherever the open chat changes.
type Switch = { sessionId: string; source: string; at: number; waiting: boolean }

let current: Switch | null = null

/** The open chat changed to `sessionId` now, by `source` (the workspace action that did it). */
export function startChatSwitch(sessionId: string, source: string) {
  const started: Switch = { sessionId, source, at: performance.now(), waiting: false }

  current = started
  // What shows once the change's own task is over was fetched, not on hand.
  setTimeout(() => {
    started.waiting = true
  }, 0)
}

/** The switch to `sessionId`, taken: it is reported once. */
export function takeChatSwitch(sessionId: string): Switch | null {
  if (current?.sessionId !== sessionId) return null
  const taken = current

  current = null

  return taken
}
