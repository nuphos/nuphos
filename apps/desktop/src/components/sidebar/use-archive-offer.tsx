import { useState } from 'react'

import { threadsUnder } from '../../lib/threadLifecycle'
import { AppAlertDialog } from '../ui/alert-dialog'
import { Checkbox } from '../ui/checkbox'

import type { AgentConversation } from '../../api'
import type { RuntimeExecution } from '../../lib/runtimeExecution'

type Offer = { sessionId: string; title: string; finished: string[]; running: number }

const plural = (count: number, one: string) => `${String(count)} ${one}${count === 1 ? '' : 's'}`

export function archiveTitle(conversations: readonly AgentConversation[], sessionId: string) {
  const conversation = conversations.find((item) => item.sessionId === sessionId)

  return conversation?.title || conversation?.firstMessage || 'this chat'
}

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
  onArchive: (sessionId: string, threadIds: string[]) => Promise<unknown> | void
}) {
  const [offer, setOffer] = useState<Offer | null>(null)
  const [withThreads, setWithThreads] = useState(true)

  /** `fresh` replaces the list the hook was given, for a caller that just re-read it. */
  function request(sessionId: string, fresh?: readonly AgentConversation[]) {
    const list = fresh ?? conversations
    const { finished, running } = threadsUnder(sessionId, list, runtimeStates)

    if (finished.length === 0) {
      void onArchive(sessionId, [])

      return
    }
    setWithThreads(true)
    setOffer({
      sessionId,
      title: archiveTitle(list, sessionId),
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
