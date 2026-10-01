import { runtimeAllows, runtimeSnapshotFresh } from '../../../lib/runtimeExecution.ts'

import type { Message, QueuedMessage, Tab } from './model.ts'
import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'

export type SendDraft = {
  id: string
  text: string
  filePaths: string[]
  turnKind?: Message['turnKind']
}

const dispatchedDrafts = new Map<string, SendDraft>()

/** Remember what a turn sent, so a refusal can put it back in the queue. */
export function rememberDispatchedDraft(streamId: string, draft: SendDraft): void {
  if (dispatchedDrafts.size > 200) dispatchedDrafts.clear()
  dispatchedDrafts.set(streamId, draft)
}

export function dispatchedDraft(streamId: string): SendDraft | undefined {
  return dispatchedDrafts.get(streamId)
}

/** A runtime that reports it will never accept sends (outdated agent) should not be waited on. */
export function runtimeMayAcceptLater(snapshot: RuntimeExecution | undefined): boolean {
  return !(
    runtimeSnapshotFresh(snapshot) &&
    snapshot?.schemaVersion !== 2 &&
    snapshot?.state !== 'disconnected'
  )
}

/** Queue a message that auto-sends once the agent allows it. */
export function queueAutoSend(tab: Tab, draft: SendDraft): Tab {
  const queued = (tab.queued ?? []).filter((item) => item.id !== draft.id)

  return { ...tab, queued: [...queued, { ...draft, autoSend: true }] }
}

/** The server refused a turn before it started: move its message back into the queue. */
export function parkRefusedTurn(tab: Tab, draft: SendDraft | undefined): Tab {
  const reset: Tab = {
    ...tab,
    streaming: false,
    streamId: null,
    streamStartedAt: null,
    phase: null,
    autoResumeAttempts: 0,
    error: null,
    agentSetupRequired: null,
  }

  if (!draft) return reset

  return {
    ...reset,
    messages: reset.messages.filter((message) => message.id !== draft.id),
    queued: [
      { ...draft, autoSend: true },
      ...(reset.queued ?? []).filter((item) => item.id !== draft.id),
    ],
  }
}

export function nextAutoSend(tab: Tab): QueuedMessage | undefined {
  return tab.queued?.find((item) => item.autoSend && !item.steering)
}

export function withoutQueued(tab: Tab, queuedId: string): Tab {
  return { ...tab, queued: tab.queued?.filter((item) => item.id !== queuedId) }
}

/** Stop auto-sending every waiting message; they stay as ordinary unsent drafts. */
export function stopAutoSend(tab: Tab): Tab {
  return {
    ...tab,
    queued: tab.queued?.map((item) => (item.autoSend ? { ...item, autoSend: false } : item)),
  }
}

/**
 * Probe fresh runtime status for one waiting tab and dispatch its first
 * auto-send message once `send` is allowed.
 */
export async function pumpAutoSend(
  tab: Tab,
  deps: {
    probe: (sessionId: string) => Promise<RuntimeExecution>
    onRuntimeState: (tabId: string, snapshot: RuntimeExecution) => void
    dispatch: (tabId: string, item: QueuedMessage) => Promise<void> | void
    onNeverSendable: (tabId: string, snapshot: RuntimeExecution) => void
  },
): Promise<'sent' | 'waiting' | 'idle' | 'unsendable'> {
  const item = nextAutoSend(tab)

  if (!item || tab.streaming) return item ? 'waiting' : 'idle'
  const snapshot = await deps.probe(tab.sessionId)

  deps.onRuntimeState(tab.id, snapshot)
  if (!runtimeMayAcceptLater(snapshot)) {
    deps.onNeverSendable(tab.id, snapshot)

    return 'unsendable'
  }
  if (!runtimeAllows(snapshot, 'send')) return 'waiting'
  await deps.dispatch(tab.id, item)

  return 'sent'
}
