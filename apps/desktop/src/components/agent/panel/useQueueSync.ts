import { useEffect } from 'react'

import { api } from '../../../api.ts'
import { runtimeTurnActive } from '../../../lib/runtimeExecution.ts'

import { syncQueued } from './queuedAutoSend.ts'

import type { PanelCtx } from './ctx'

/**
 * Read the server queue whenever a tab comes into view or a turn ends, so
 * the strip drops what the server dropped or another device took back, and
 * shows what still waits after a restart. A turn the server starts from the
 * queue counts too: it can put the message back held by the usage limit.
 * Turns from a Trigger or another agent are often too quick to show as busy,
 * so a transcript that moved reads it again (#5355).
 */
export function useQueueSync({
  activeTab,
  setTabs,
  teamId,
}: Pick<PanelCtx, 'activeTab' | 'setTabs' | 'teamId'>) {
  const tabId = activeTab?.id
  const sessionId = activeTab?.unsaved ? undefined : activeTab?.sessionId
  const busy = Boolean(activeTab?.streaming) || runtimeTurnActive(activeTab?.runtimeState)
  const transcript = activeTab?.messages

  useEffect(() => {
    if (!tabId || !sessionId || busy) return
    let current = true

    void api
      .agentListQueue(sessionId, teamId)
      .then(({ messages, held }) => {
        if (!current) return
        setTabs((tabs) => tabs.map((t) => (t.id === tabId ? syncQueued(t, messages, held) : t)))
      })
      .catch(() => {})

    return () => {
      current = false
    }
  }, [tabId, sessionId, busy, transcript, setTabs, teamId])
}
