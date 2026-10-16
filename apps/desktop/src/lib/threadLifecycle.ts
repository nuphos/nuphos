import {
  newestRuntimeSnapshot,
  runtimeBackgroundRunning,
  runtimeTurnActive,
} from './runtimeExecution.ts'

import type { RuntimeExecution } from './runtimeExecution.ts'

type Conversation = {
  sessionId: string
  parentSessionId?: string
  runtimeState?: RuntimeExecution
  /** A teammate's conversation: the viewer can't archive it. */
  readOnly?: boolean
}

export type ThreadState = 'running' | 'waiting' | 'done' | 'stopped'

/** The states the in-chat thread badges show, read the same way so both places agree. */
export function threadState(snapshot: RuntimeExecution | undefined): ThreadState {
  if (runtimeTurnActive(snapshot))
    return (snapshot?.permissionWaits ?? 0) > 0 ? 'waiting' : 'running'

  return snapshot?.state === 'interrupted' || snapshot?.state === 'disconnected'
    ? 'stopped'
    : 'done'
}

/** Work still in flight, including background tools, so archiving never strands it. */
export function threadRunning(snapshot: RuntimeExecution | undefined): boolean {
  const state = threadState(snapshot)

  return state === 'running' || state === 'waiting' || runtimeBackgroundRunning(snapshot)
}

/**
 * The viewer's own threads under a chat, split by whether a snapshot says they
 * finished. A thread with a running thread of its own, or with no snapshot yet,
 * stays. A teammate's thread is never offered: only its owner may archive it.
 */
export function threadsUnder(
  sessionId: string,
  conversations: readonly Conversation[],
  runtimeStates: ReadonlyMap<string, RuntimeExecution>,
): { finished: string[]; running: string[] } {
  const children = new Map<string, Conversation[]>()

  for (const conversation of conversations) {
    if (!conversation.parentSessionId) continue
    children.set(conversation.parentSessionId, [
      ...(children.get(conversation.parentSessionId) ?? []),
      conversation,
    ])
  }
  const finished: string[] = []
  const running: string[] = []
  const seen = new Set([sessionId])
  // Returns whether this thread and everything under it is done.
  const visit = (thread: Conversation): boolean => {
    if (seen.has(thread.sessionId)) return true
    seen.add(thread.sessionId)
    const kidsDone = (children.get(thread.sessionId) ?? []).map(visit).every(Boolean)
    const snapshot = newestRuntimeSnapshot(thread.runtimeState, runtimeStates.get(thread.sessionId))
    const done = kidsDone && snapshot !== undefined && !threadRunning(snapshot)

    const bucket = done ? finished : running

    if (!thread.readOnly) bucket.push(thread.sessionId)

    return done
  }

  for (const kid of children.get(sessionId) ?? []) visit(kid)

  return { finished, running }
}
