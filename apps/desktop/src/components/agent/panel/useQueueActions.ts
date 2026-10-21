import { useCallback } from 'react'

import { api } from '../../../api'
import { parseAtlasError } from '../../../api/errors'
import { runtimeAllows } from '../../../lib/runtimeExecution'
import { toast } from '../../ui/toast'

import { showQueued, withoutQueued } from './queuedAutoSend'

import type { PanelCtx } from './ctx'

/** The queue strip's actions on this person's messages waiting in the server queue. */
export function useQueueActions({
  tabsRef,
  setTabs,
  teamId,
  sendSteering,
}: Pick<PanelCtx, 'tabsRef' | 'setTabs' | 'teamId'> & {
  sendSteering: (tabId: string, text: string, filePaths: string[], queuedId: string) => Promise<void>
}) {
  // Steer a waiting message into the running turn; the server moves it off the queue.
  const steerQueued = useCallback(
    async (tabId: string, queuedId: string) => {
      const tab = tabsRef.current.find((candidate) => candidate.id === tabId)
      const draft = tab?.queued?.find((candidate) => candidate.id === queuedId)

      if (!tab || !draft || draft.steering || !runtimeAllows(tab.runtimeState, 'steer')) return
      await sendSteering(tabId, draft.text, draft.filePaths, queuedId)
    },
    [sendSteering, tabsRef],
  )

  // Take a waiting message back. A 404 means its turn already started, or it is gone.
  const removeQueued = useCallback(
    async (tabId: string, queuedId: string) => {
      const tab = tabsRef.current.find((candidate) => candidate.id === tabId)

      if (!tab) return
      const item = tab.queued?.find((candidate) => candidate.id === queuedId)

      setTabs((previous) =>
        previous.map((candidate) =>
          candidate.id === tabId ? withoutQueued(candidate, queuedId) : candidate,
        ),
      )
      await api.agentUnqueueMessage(tab.sessionId, queuedId, teamId).catch((error: unknown) => {
        // A 404 means its turn started or it is gone; anything else, it still waits.
        if (parseAtlasError(error).code === 'not_found' || !item) return
        setTabs((previous) =>
          previous.map((candidate) =>
            candidate.id === tabId ? showQueued(candidate, item) : candidate,
          ),
        )
        toast.apiError('Could not take the message back', error)
      })
    },
    [tabsRef, setTabs, teamId],
  )

  return { steerQueued, removeQueued }
}
