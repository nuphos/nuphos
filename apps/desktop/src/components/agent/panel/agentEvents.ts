import { api } from '../../../api'
import { rememberTerminalRuntimeStream } from '../../../lib/runtimeWakeup'

import { applyStreamEvent } from './agentEventsApply'
import { handleSseControlFrame } from './agentEventsSse'
import { appendMemoryIngestPart } from './applyEvent'
import { observeTurnUnread } from './turnUnread'

import type { PanelCtx } from './ctx'

const LEARNED_MEMORY_POLL_DELAYS_MS = [4_000, 8_000, 12_000, 12_000] as const

function appendLearnedMemories(
  ctx: Pick<PanelCtx, 'queueTranscriptSync' | 'setTabs'>,
  sessionId: string,
  memories: Awaited<ReturnType<typeof api.agentGetMemoryIngestEvent>>['memories'],
  turnKey?: string,
  targetMessageId?: string,
) {
  if (memories.length === 0) return

  const firstMemory = memories[0]

  ctx.setTabs((prev) =>
    prev.map((t) => {
      if (t.sessionId !== sessionId) return t
      const nextTab = appendMemoryIngestPart(
        t,
        {
          type: 'memory-ingest',
          id: turnKey
            ? `${sessionId}:auto-ingest-turn:${turnKey}`
            : `${sessionId}:auto-ingest:${firstMemory.id}`,
          sessionId,
          kind: 'ok',
          text:
            memories.length === 1
              ? '1 memory learned'
              : `${String(memories.length)} memories learned`,
          createdAt: firstMemory.createdAt,
          memories,
          detailsLoadedAt: new Date().toISOString(),
        },
        targetMessageId,
      )

      if (nextTab !== t) ctx.queueTranscriptSync(nextTab, 250)

      return nextTab
    }),
  )
}

function pollLearnedMemories(
  ctx: Pick<PanelCtx, 'queueTranscriptSync' | 'setTabs' | 'teamIdRef'>,
  sessionId: string,
  turnKey: string,
  targetMessageId: string | undefined,
  attempt = 0,
) {
  const delay = LEARNED_MEMORY_POLL_DELAYS_MS.at(attempt)

  if (delay === undefined) return
  window.setTimeout(() => {
    void api
      .agentGetMemoryIngestEvent(sessionId, ctx.teamIdRef.current, undefined, turnKey)
      .then((page) => {
        if (page.status === 'pending') {
          pollLearnedMemories(ctx, sessionId, turnKey, targetMessageId, attempt + 1)

          return
        }
        appendLearnedMemories(ctx, sessionId, page.memories, turnKey, targetMessageId)
      })
      .catch(() => pollLearnedMemories(ctx, sessionId, turnKey, targetMessageId, attempt + 1))
  }, delay)
}

export type AgentEventCtx = Pick<
  PanelCtx,
  | 'autoLearnedFetchedRef'
  | 'enqueueTextDelta'
  | 'flushTextBuffer'
  | 'handleEndEvent'
  | 'queueTranscriptSync'
  | 'setTabs'
  | 'streamOwnersRef'
  | 'stoppedRunIdsRef'
  | 'syncTimersRef'
  | 'tabsRef'
  | 'teamIdRef'
  | 'textBuffersRef'
  | 'turnCompleteRef'
  | 'turnPausedRef'
>

export function handleAgentEvent(ctx: AgentEventCtx, streamId: string, event: unknown) {
  const {
    tabsRef,
    setTabs,
    streamOwnersRef,
    textBuffersRef,
    syncTimersRef,
    autoLearnedFetchedRef,
    teamIdRef,
    handleEndEvent,
  } = ctx
  const ev = event as Record<string, unknown>
  const evType = ev.type as string | undefined

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
    // A3 auto-ingest: the distiller resolves seconds AFTER the stream closes,
    // so the learned chip often can't ride the live SSE. Poll this exact turn
    // to completion; part-id dedup absorbs the rare live-frame overlap.
    const endedTab = tabsRef.current.find((t) => t.streamId === streamId)
    const endedSessionId = endedTab?.sessionId
    const endedAssistantMessageId = [...(endedTab?.messages ?? [])]
      .reverse()
      .find((message) => message.role === 'assistant')?.id
    const turnKey = ctx.turnCompleteRef.current.get(streamId)?.turnKey

    if (endedSessionId && !autoLearnedFetchedRef.current.has(streamId)) {
      autoLearnedFetchedRef.current.add(streamId)

      if (turnKey) pollLearnedMemories(ctx, endedSessionId, turnKey, endedAssistantMessageId)
      else {
        // Backward compatibility for a backend that predates terminal turnKey.
        const turnEndedAt = Date.now()

        window.setTimeout(() => {
          void api
            .agentGetMemoryIngestEvent(endedSessionId, teamIdRef.current)
            .then((page) =>
              appendLearnedMemories(
                ctx,
                endedSessionId,
                page.memories.filter(
                  (memory) => Date.parse(memory.createdAt) > turnEndedAt - 3 * 60_000,
                ),
                undefined,
                endedAssistantMessageId,
              ),
            )
            .catch(() => null)
        }, 12_000)
      }
    }
    handleEndEvent(streamId)

    return
  }
  applyStreamEvent(ctx, streamId, ev, evType)
}
