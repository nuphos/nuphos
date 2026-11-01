import { useCallback } from 'react'

import { parseAtlasError } from '../../../api/errors.ts'
import { api } from '../../../api.ts'
import { t } from '../../../i18n/index.ts'
import { toast } from '../../ui/toast.ts'

import { optimisticSenderMetadata } from './optimisticSender.ts'
import { normalizeTransferUploadPart } from './parts.ts'
import { withoutQueued } from './queuedAutoSend.ts'
import { appendSteering } from './steering.ts'

import type { PanelCtx } from './ctx.ts'

export function useSteering({
  tabsRef,
  setTabs,
  teamId,
  currentUser,
  fallback,
}: Pick<PanelCtx, 'tabsRef' | 'setTabs' | 'teamId' | 'currentUser'> & {
  /** Send it as a message instead; the server queues it behind the turn. */
  fallback: (tabId: string, text: string, filePaths: string[]) => Promise<void>
}) {
  /**
   * `queuedId` names a message waiting in the server queue: the server takes
   * it off the queue to steer it and keeps it queued if the steer is refused.
   */
  const sendSteering = useCallback(
    async (tabId: string, text: string, filePaths: string[] = [], queuedId?: string) => {
      const tab = tabsRef.current.find((t) => t.id === tabId)

      if (!tab?.sessionId) return
      const id = queuedId ?? crypto.randomUUID()
      const markSteering = (steering: boolean) =>
        setTabs((tabs) =>
          tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  queued: t.queued?.map((q) => (q.id === id ? { ...q, steering } : q)),
                }
              : t,
          ),
        )

      // The draft remains recoverable until the runtime acknowledges delivery.
      if (queuedId) markSteering(true)
      else
        setTabs((tabs) =>
          tabs.map((t) =>
            t.id === tabId
              ? { ...t, queued: [...(t.queued ?? []), { id, text, filePaths, steering: true }] }
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
        const sent = await api.agentSteerConversation(
          tab.sessionId,
          text,
          teamId,
          groupId,
          queuedId,
        )
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
              ? { ...appendSteering(t, receipt), queued: t.queued?.filter((q) => q.id !== id) }
              : t,
          ),
        )
      } catch (error) {
        if (queuedId) {
          markSteering(false)
          toast.apiError(t('Could not send into the running turn; it is still in the queue'), error)

          return
        }
        // The turn is usually over by now, or not this person's: send it as a message.
        setTabs((tabs) => tabs.map((t) => (t.id === tabId ? withoutQueued(t, id) : t)))
        if (!isSteeringUnavailable(error))
          toast.apiError(
            t(
              'Could not steer the current turn; it was sent as a message at the back of the queue',
            ),
            error,
          )
        await fallback(tabId, text, filePaths)
      }
    },
    [tabsRef, setTabs, teamId, currentUser, fallback],
  )

  return sendSteering
}

/** The expected refusal: the turn ended, or it belongs to someone else. */
function isSteeringUnavailable(error: unknown): boolean {
  return parseAtlasError(error).code === 'runtime_steering_unavailable'
}
