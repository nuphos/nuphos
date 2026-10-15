import { useState } from 'react'

import { threadsUnder } from '../../lib/threadLifecycle'
import { AppAlertDialog } from '../ui/alert-dialog'
import { Checkbox } from '../ui/checkbox'

import type { AgentConversation } from '../../api'
import type { RuntimeExecution } from '../../lib/runtimeExecution'

type Offer = { sessionId: string; title: string; finished: string[]; running: number }

const plural = (count: number, one: string) => `${String(count)} ${one}${count === 1 ? '' : 's'}`

/**
 * Archiving a chat with finished threads asks whether they go too; running
 * threads always stay. A chat without finished threads archives at once, as
 * before.
 */
export function useArchiveOffer({
  conversations,
  runtimeStates,
  onArchive,
}: {
  conversations: readonly AgentConversation[]
  runtimeStates: ReadonlyMap<string, RuntimeExecution>
  /** Archives the chat, then the given threads. */
  onArchive: (sessionId: string, threadIds: string[]) => Promise<void> | void
}) {
  const [offer, setOffer] = useState<Offer | null>(null)
  const [withThreads, setWithThreads] = useState(true)

  function request(sessionId: string) {
    const { finished, running } = threadsUnder(sessionId, conversations, runtimeStates)

    if (finished.length === 0) {
      void onArchive(sessionId, [])

      return
    }
    const conversation = conversations.find((item) => item.sessionId === sessionId)

    setWithThreads(true)
    setOffer({
      sessionId,
      title: conversation?.title || conversation?.firstMessage || 'this chat',
      finished,
      running: running.length,
    })
  }

  const dialog = (
    <AppAlertDialog
      open={offer !== null}
      title={`Archive “${offer?.title ?? ''}”?`}
      description={
        offer && (
          <>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-main">
              <Checkbox
                checked={withThreads}
                onCheckedChange={(checked) => setWithThreads(checked)}
              />
              Also archive its {plural(offer.finished.length, 'finished thread')}
            </label>
            {offer.running > 0 && (
              <span className="mt-1 block text-tertiary">
                {plural(offer.running, 'running thread')} will stay in the sidebar.
              </span>
            )}
          </>
        )
      }
      confirmLabel="Archive"
      onConfirm={() => {
        if (offer) void onArchive(offer.sessionId, withThreads ? offer.finished : [])
      }}
      onClose={() => setOffer(null)}
    />
  )

  return { request, dialog }
}
