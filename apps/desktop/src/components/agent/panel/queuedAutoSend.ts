import { runtimeSnapshotFresh } from '../../../lib/runtimeExecution.ts'

import type { Message, QueuedMessage, Tab } from './model.ts'
import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'

// The session's queue lives on the server. Every message is sent at once; a
// busy session answers that it is waiting, and the queue strip shows it until
// its turn starts. This module is the client's view of that queue.

export type SendDraft = {
  id: string
  text: string
  filePaths: string[]
  turnKind?: Message['turnKind']
}

const dispatchedDrafts = new Map<string, SendDraft>()
// Sends made while the tab showed another turn; they must not take its stream.
const sideSends = new Map<string, string>()

/** Remember what a turn sent, so a queued or refused send can be shown waiting. */
export function rememberDispatchedDraft(streamId: string, draft: SendDraft): void {
  if (dispatchedDrafts.size > 200) dispatchedDrafts.clear()
  dispatchedDrafts.set(streamId, draft)
}

export function dispatchedDraft(streamId: string): SendDraft | undefined {
  return dispatchedDrafts.get(streamId)
}

/** A send from a tab that already shows a running turn. */
export function rememberSideSend(streamId: string, tabId: string): void {
  if (sideSends.size > 200) sideSends.clear()
  sideSends.set(streamId, tabId)
}

/** The tab a side send belongs to, once; later frames route by the tab's own stream. */
export function takeSideSend(streamId: string): string | undefined {
  const tabId = sideSends.get(streamId)

  sideSends.delete(streamId)

  return tabId
}

/** A runtime that reports it will never accept sends (outdated agent) should not be waited on. */
export function runtimeMayAcceptLater(snapshot: RuntimeExecution | undefined): boolean {
  return !(
    runtimeSnapshotFresh(snapshot) &&
    snapshot?.schemaVersion !== 2 &&
    snapshot?.state !== 'disconnected'
  )
}

/** An unsaved fork has no server session to report a runtime state, so its first
 *  send goes out at once, like a new chat's; sends during that one queue. */
export function sendsAsNewSession(tab: Pick<Tab, 'unsaved' | 'streaming'>): boolean {
  return tab.unsaved === true && !tab.streaming
}

/** Show a message as waiting in the session queue. */
export function showQueued(tab: Tab, draft: SendDraft): Tab {
  const queued = (tab.queued ?? []).filter((item) => item.id !== draft.id)

  return { ...tab, queued: [...queued, { ...draft }] }
}

/**
 * The server queued this turn's message instead of starting it: it leaves the
 * transcript for the queue strip, and the tab follows whichever turn runs.
 */
export function showTurnQueued(tab: Tab, draft: SendDraft | undefined): Tab {
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

  return showQueued(
    { ...reset, messages: reset.messages.filter((message) => message.id !== draft.id) },
    draft,
  )
}

/** A side send started its own turn: the tab follows that stream now. */
export function adoptSideStream(tab: Tab, streamId: string, draftId: string | undefined): Tab {
  return {
    ...tab,
    streaming: true,
    connected: false,
    streamId,
    attachedStreamId: null,
    streamStartedAt: Date.now(),
    phase: null,
    error: null,
    queued: tab.queued?.filter((item) => item.id !== draftId),
  }
}

/** What still waits: a message whose turn started is in the transcript already. */
export function waitingMessages(tab: Pick<Tab, 'queued' | 'messages'>): QueuedMessage[] {
  const started = new Set(tab.messages.map((message) => message.id))

  return (tab.queued ?? []).filter((item) => !started.has(item.id))
}

export function withoutQueued(tab: Tab, queuedId: string): Tab {
  return { ...tab, queued: tab.queued?.filter((item) => item.id !== queuedId) }
}
