import { useEffect } from 'react'

import { api } from '../../../api'

import { syncQueued } from './queuedAutoSend'

import type { PanelCtx } from './ctx'

/**
 * Read the server queue whenever a tab comes into view or its turn ends, so
 * the strip drops what the server dropped or another device took back, and
 * shows what still waits after a restart.
 */
export function useQueueSync({
  activeTab,
  setTabs,
  teamId,
}: Pick<PanelCtx, 'activeTab' | 'setTabs' | 'teamId'>) {
  const tabId = activeTab?.id
  const sessionId = activeTab?.unsaved ? undefined : activeTab?.sessionId
  const streaming = activeTab?.streaming ?? false

  useEffect(() => {
    if (!tabId || !sessionId || streaming) return
    let current = true

    void api
      .agentListQueue(sessionId, teamId)
      .then(({ messages }) => {
        if (!current) return
        setTabs((tabs) => tabs.map((t) => (t.id === tabId ? syncQueued(t, messages) : t)))
      })
      .catch(() => {})

    return () => {
      current = false
    }
  }, [tabId, sessionId, streaming, setTabs, teamId])
}
