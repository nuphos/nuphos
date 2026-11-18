// How long a chat takes to show after its sidebar row is clicked: the `chat_switch` event.
import { useLayoutEffect } from 'react'

import { track } from './analytics'

let pending: { sessionId: string; at: number } | null = null

/** A row was clicked: the switch to `sessionId` starts now. */
export function startChatSwitch(sessionId: string) {
  pending = { sessionId, at: performance.now() }
}

/** Reports the switch to `sessionId` at the first frame it shows its messages. */
export function useChatSwitchShown(
  sessionId: string | null | undefined,
  kind: 'bot' | 'task',
  shown: boolean,
) {
  useLayoutEffect(() => {
    const start = pending

    if (!shown || !start || start.sessionId !== sessionId) return
    pending = null
    requestAnimationFrame(() => {
      track('chat_switch', { kind, ms: Math.round(performance.now() - start.at) })
    })
  }, [sessionId, kind, shown])
}
