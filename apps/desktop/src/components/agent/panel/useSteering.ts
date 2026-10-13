import { useCallback } from 'react'

import { api } from '../../../api'
import { toast } from '../../ui/toast'

import { optimisticSenderMetadata } from './optimisticSender'
import { normalizeTransferUploadPart } from './parts'
import { markAutoSend } from './queuedAutoSend'
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
      filePaths: string[] = [],
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
        // Attachments take the normal upload path; the backend places them on
        // the runtime and returns them with the receipt.
        const groupId =
          filePaths.length > 0 && teamId
            ? (await api.fileTransferUpload({ teamId, sessionId: tab.sessionId, filePaths }))
                .groupId
            : undefined
        const sent = await api.agentSteerConversation(tab.sessionId, text, teamId, groupId)
        const metadata = optimisticSenderMetadata(currentUser, Date.now())
        const upload = sent.upload ? normalizeTransferUploadPart(sent.upload) : null
        const receipt = {
          type: 'data-steering' as const,
          data: {
            id: sent.messageId,
            text: sent.text ?? text,
            ...(upload ? { upload } : {}),
            ...(metadata ? { metadata } : {}),
          },
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
              ? // The turn is usually over by now: send it as the next one.
                markAutoSend(t, queuedId)
              : t,
          ),
        )
        toast.apiError('Could not steer the current turn; it will be sent next', error)
      }
    },
    [tabsRef, setTabs, teamId, currentUser],
  )

  return sendSteering
}
