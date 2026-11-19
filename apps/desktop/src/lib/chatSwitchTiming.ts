// How long a chat takes to show after it was opened: the `chat_switch` event.
import { useLayoutEffect } from 'react'

import { track } from './analytics.ts'
import { takeChatSwitch } from './chatSwitch.ts'

/**
 * Reports the switch to `sessionId` at the first frame it shows its messages: `ms` since it was
 * opened, and `cached` when they were on hand, shown in the opening's own task.
 */
export function useChatSwitchShown(
  sessionId: string | null | undefined,
  kind: 'bot' | 'task',
  shown: boolean,
) {
  useLayoutEffect(() => {
    const start = shown && sessionId ? takeChatSwitch(sessionId) : null

    if (!start) return
    const cached = !start.waiting

    requestAnimationFrame(() => {
      track('chat_switch', {
        kind,
        cached,
        source: start.source,
        ms: Math.round(performance.now() - start.at),
      })
    })
  }, [sessionId, kind, shown])
}
