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
 */
export function useQueueSync({
  activeTab,
  setTabs,
  teamId,
}: Pick<PanelCtx, 'activeTab' | 'setTabs' | 'teamId'>) {
  const tabId = activeTab?.id
  const sessionId = activeTab?.unsaved ? undefined : activeTab?.sessionId
  const busy = Boolean(activeTab?.streaming) || runtimeTurnActive(activeTab?.runtimeState)

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
  }, [tabId, sessionId, busy, setTabs, teamId])
}
