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
}

/**
 * Still has work in flight: a turn, background tools, or a question waiting
 * on someone. Everything else counts as done.
 */
export function threadRunning(snapshot: RuntimeExecution | undefined): boolean {
  return (
    runtimeTurnActive(snapshot) ||
    runtimeBackgroundRunning(snapshot) ||
    Boolean(snapshot?.requestPending)
  )
}

/**
 * The threads under a chat, split by whether they are finished. A thread with
 * a running thread of its own is not finished, so archiving can never strand
 * running work under an archived parent.
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
    const done =
      kidsDone &&
      !threadRunning(
        newestRuntimeSnapshot(thread.runtimeState, runtimeStates.get(thread.sessionId)),
      )

    ;(done ? finished : running).push(thread.sessionId)

    return done
  }

  for (const kid of children.get(sessionId) ?? []) visit(kid)

  return { finished, running }
}
