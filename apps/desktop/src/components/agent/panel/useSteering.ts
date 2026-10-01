import { useCallback } from 'react'

import { api } from '../../../api'
import { toast } from '../../ui/toast'

import { optimisticSenderMetadata } from './optimisticSender'
import { appendSteering } from './steering'

import type { PanelCtx } from './ctx'

export function useSteering({
  tabsRef,
  setTabs,
  teamId,
  currentUser,
}: Pick<PanelCtx, 'tabsRef' | 'setTabs' | 'teamId' | 'currentUser'>) {
  const sendSteering = useCallback(
    async (
      tabId: string,
      text: string,
      filePaths: string[],
      queuedId: string = crypto.randomUUID(),
    ) => {
      const tab = tabsRef.current.find((t) => t.id === tabId)

      if (!tab?.sessionId) return
      // The draft remains recoverable until the runtime acknowledges delivery.
      setTabs((tabs) =>
        tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                queued: [
                  ...(t.queued ?? []).filter((q) => q.id !== queuedId),
                  { id: queuedId, text, filePaths, steering: true },
                ],
              }
            : t,
        ),
      )
      try {
        if (filePaths.length)
          throw new Error('Send attachments after this turn; steering currently accepts text.')
        const { messageId } = await api.agentSteerConversation(tab.sessionId, text, teamId)
        const metadata = optimisticSenderMetadata(currentUser, Date.now())
        const receipt = {
          type: 'data-steering' as const,
          data: { id: messageId, text, ...(metadata ? { metadata } : {}) },
        }

        setTabs((tabs) =>
          tabs.map((t) =>
            t.id === tabId
              ? {
                  ...(t.streamId === tab.streamId &&
                  t.messages.at(-1)?.id === tab.messages.at(-1)?.id
                    ? appendSteering(t, receipt)
                    : t),
                  queued: t.queued?.filter((q) => q.id !== queuedId),
                }
              : t,
          ),
        )
      } catch (error) {
        setTabs((tabs) =>
          tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  queued: t.queued?.map((q) => (q.id === queuedId ? { ...q, steering: false } : q)),
                }
              : t,
          ),
        )
        toast.apiError('Could not steer the current turn', error)
      }
    },
    [tabsRef, setTabs, teamId, currentUser],
  )

  return sendSteering
}
