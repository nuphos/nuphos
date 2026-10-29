import { t } from '../../../i18n/index.ts'
import { rememberTerminalRuntimeStream } from '../../../lib/runtimeWakeup'
import { toast } from '../../ui/toast'

import { applyStreamEvent } from './agentEventsApply'
import { handleSseControlFrame } from './agentEventsSse'
import { adoptSideStream, dispatchedDraft, takeSideSend, withoutQueued } from './queuedAutoSend'
import { observeTurnUnread } from './turnUnread'

import type { PanelCtx } from './ctx'
import type { Tab } from './model'

export type AgentEventCtx = Pick<
  PanelCtx,
  | 'enqueueTextDelta'
  | 'flushTextBuffer'
  | 'handleEndEvent'
  | 'queueTranscriptSync'
  | 'setTabs'
  | 'streamOwnersRef'
  | 'stoppedRunIdsRef'
  | 'syncTimersRef'
  | 'tabsRef'
  | 'textBuffersRef'
  | 'turnCompleteRef'
  | 'turnPausedRef'
>

/**
 * A message sent while the tab showed another turn waits in the queue strip.
 * If the server started it at once instead, the tab follows its stream.
 */
function followSideSend(
  ctx: Pick<AgentEventCtx, 'tabsRef' | 'setTabs'>,
  streamId: string,
  evType: string | undefined,
) {
  const tabId = takeSideSend(streamId)

  if (!tabId || !evType || evType === 'queued' || evType === 'end') return
  const draft = dispatchedDraft(streamId)

  // Not queued: the strip must not show what the server does not hold.
  if (SIDE_SEND_FAILED.has(evType)) {
    ctx.setTabs((tabs) =>
      tabs.map((t) => (t.id === tabId && draft ? withoutQueued(t, draft.id) : t)),
    )
    toast.error(
      t('Your message was not sent'),
      draft ? t('“{text}” — send it again.', { text: draft.text.slice(0, 120) }) : undefined,
    )

    return
  }
  const adopt = (tabs: Tab[]) =>
    tabs.map((t) => (t.id === tabId ? adoptSideStream(t, streamId, draft?.id) : t))

  // Synchronously too: this event and the next must route to the tab.
  ctx.tabsRef.current = adopt(ctx.tabsRef.current)
  ctx.setTabs(adopt)
}

// Events that end a side send without the server holding its message.
const SIDE_SEND_FAILED = new Set(['runtime-not-ready', 'error', 'aborted', 'agent-setup-required'])

export function handleAgentEvent(ctx: AgentEventCtx, streamId: string, event: unknown) {
  const { tabsRef, setTabs, streamOwnersRef, textBuffersRef, syncTimersRef, handleEndEvent } = ctx
  const ev = event as Record<string, unknown>
  const evType = ev.type as string | undefined

  if (!tabsRef.current.some((t) => t.streamId === streamId)) followSideSend(ctx, streamId, evType)
  const owner = tabsRef.current.find((t) => t.streamId === streamId)

  if (owner) {
    rememberTerminalRuntimeStream(ctx.stoppedRunIdsRef.current, owner.sessionId, streamId, ev)
    streamOwnersRef.current.set(streamId, {
      sessionId: owner.sessionId,
      title: owner.title,
    })
  }
  observeTurnUnread(owner?.sessionId ?? streamOwnersRef.current.get(streamId)?.sessionId, ev)
  if (
    evType === 'sse' &&
    handleSseControlFrame(ctx, streamId, ev.data as Record<string, unknown>)
  ) {
    return
  }
  // Main process is silently restarting an unresumable run. Drop the
  // partial assistant turn so the fresh stream's frames don't get merged
  // into a half-finished message.
  if (evType === 'reset-partial') {
    const entry = textBuffersRef.current.get(streamId)

    if (entry?.timer !== null && entry?.timer !== undefined) {
      window.clearTimeout(entry.timer)
    }
    textBuffersRef.current.delete(streamId)
    setTabs((prev) =>
      prev.map((t) => {
        if (t.streamId !== streamId) return t
        // Cancel any pending transcript-sync debounce for this session;
        // otherwise its captured pre-reset tab snapshot would write the
        // partial assistant turn back to the backend after we drop it.
        const queuedSync = syncTimersRef.current.get(t.sessionId)

        if (queuedSync) {
          clearTimeout(queuedSync)
          syncTimersRef.current.delete(t.sessionId)
        }
        const msgs = t.messages.slice()

        if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
          msgs.pop()
        }

        return { ...t, messages: msgs, connected: false, phase: null, error: null }
      }),
    )

    return
  }
  // End-of-stream needs to consult the turn-complete sentinel and may fire
  // a side-effecting auto-resume — handled out-of-band from the main
  // reducer below.
  if (evType === 'end') {
    handleEndEvent(streamId)

    return
  }
  applyStreamEvent(ctx, streamId, ev, evType)
}
