import {
  appendMemoryProvenancePart,
  removeMemoryIngestPart,
  appendMemoryIngestPart,
} from './applyEvent'
import { startAutonomousTurn } from './autonomousTurn'
import { normalizeMemoryProvenanceLabels } from './memoryProvenanceLabels'
import { AGENT_TURN_COMPLETE_EVENT, AGENT_TURN_PAUSED_EVENT, AGENT_TURN_START_EVENT } from './model'
import { fromPersistedMessages } from './persistence'
import { handleRuntimeStateFrame } from './runtimeStateFrame'
import { eventEmittedAt } from './sessionContinuity'
import { parseStallDetail, uid } from './stall'
import {
  parseAgentPhase,
  shouldRemoveMemoryIngestFeedback,
  memoryIngestEventId,
  formatMemoryIngestFeedback,
} from './status'
import { appendSteering, parseSteeringPart } from './steering'
import { startUserTurn } from './turnBoundaries'
import { appendTurnInterruptedPart, normalizeTurnInterruptedReason } from './turnInterrupted'

import type { PanelCtx } from './ctx'
import type { MemoryProvenancePart, ToolAuthorization, TurnInterruptedPart } from './parts'

/** One-line labels the backend sends with a provenance frame, so the ribbon can
 * name what was remembered without fetching each memory back. Frames from
 * before this existed carry none — the view still falls back to fetching. */
function memoryLabelsFrom(sse: Record<string, unknown>): { labels?: Record<string, string> } {
  const labels = normalizeMemoryProvenanceLabels(sse.labels)

  return labels && Object.keys(labels).length > 0 ? { labels } : {}
}

export function handleSseControlFrame(
  ctx: Pick<
    PanelCtx,
    | 'flushTextBuffer'
    | 'enqueueTextDelta'
    | 'queueTranscriptSync'
    | 'setTabs'
    | 'turnCompleteRef'
    | 'turnPausedRef'
  >,
  streamId: string,
  sse: Record<string, unknown>,
): boolean {
  const { setTabs, turnCompleteRef, turnPausedRef, enqueueTextDelta, queueTranscriptSync } = ctx

  if (handleRuntimeStateFrame(ctx, streamId, sse)) return true
  if (sse.type === 'atlas-transcript-snapshot' && Array.isArray(sse.messages)) {
    ctx.flushTextBuffer(streamId)
    const messages = fromPersistedMessages(sse.messages)

    setTabs((prev) =>
      prev.map((tab) =>
        tab.streamId === streamId ? { ...tab, messages, historyBaseIndex: 0 } : tab,
      ),
    )

    return true
  }
  if (sse.type === AGENT_TURN_START_EVENT && Array.isArray(sse.messages)) {
    ctx.flushTextBuffer(streamId)
    const input = fromPersistedMessages(sse.messages)

    setTabs((prev) => prev.map((tab) => startUserTurn(tab, streamId, input)))

    return true
  }
  if (sse.type === 'atlas-autonomous-turn-start') {
    const messageId =
      typeof sse.messageId === 'string' && sse.messageId.length > 0
        ? sse.messageId
        : `autonomous:${streamId}`

    setTabs((prev) => prev.map((tab) => startAutonomousTurn(tab, streamId, messageId)))

    return true
  }
  if (sse.type === 'text-delta') {
    const delta =
      [sse.delta, sse.text, sse.content, sse.textDelta].find(
        (value): value is string => typeof value === 'string' && value.length > 0,
      ) ?? ''

    setTabs((prev) => {
      const tab = prev.find((t) => t.streamId === streamId)

      if (!tab || tab.phase === 'stopping' || (tab.connected && tab.phase === null)) return prev

      return prev.map((t) => (t.streamId === streamId ? { ...t, connected: true, phase: null } : t))
    })
    enqueueTextDelta(streamId, delta)

    return true
  }
  if (sse.type === 'start') {
    setTabs((prev) => {
      const tab = prev.find((t) => t.streamId === streamId)

      if (!tab || tab.phase === 'stopping' || (tab.connected && tab.phase === 'thinking'))
        return prev

      return prev.map((t) =>
        t.streamId === streamId ? { ...t, connected: true, phase: 'thinking' } : t,
      )
    })

    return true
  }
  // Transcript boundary only; execution comes from runtime-state.
  if (sse.type === AGENT_TURN_COMPLETE_EVENT) {
    turnCompleteRef.current.set(streamId, {
      ...(typeof sse.turnKey === 'string' ? { turnKey: sse.turnKey } : {}),
    })

    return true
  }
  if (sse.type === 'memory-provenance') {
    const asStrings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    const personalIds = asStrings((sse as { recalledPersonalIds?: unknown }).recalledPersonalIds)
    const teamIds = asStrings((sse as { recalledTeamIds?: unknown }).recalledTeamIds)
    const fetchedIds = asStrings((sse as { fetchedIds?: unknown }).fetchedIds)
    const fetchedPersonalIds = asStrings(
      (sse as { fetchedPersonalIds?: unknown }).fetchedPersonalIds,
    )
    const fetchedTeamIds = asStrings((sse as { fetchedTeamIds?: unknown }).fetchedTeamIds)

    if (personalIds.length === 0 && teamIds.length === 0 && fetchedIds.length === 0) return true
    setTabs((prev) =>
      prev.map((t) => {
        if (t.streamId !== streamId) return t
        const sseSessionId = typeof sse.sessionId === 'string' ? sse.sessionId : ''
        const part: MemoryProvenancePart = {
          type: 'memory-provenance',
          id: `${sseSessionId || t.sessionId || streamId}:memprov`,
          sessionId: (typeof sse.sessionId === 'string' ? sse.sessionId : t.sessionId) ?? '',
          personalIds,
          teamIds,
          fetchedIds,
          fetchedCount: fetchedIds.length,
          fetchedPersonalIds,
          fetchedTeamIds,
          ...(typeof (sse as { deliveryMode?: unknown }).deliveryMode === 'string'
            ? { deliveryMode: (sse as { deliveryMode: string }).deliveryMode }
            : {}),
          ...(typeof (sse as { turnKey?: unknown }).turnKey === 'string'
            ? { turnKey: (sse as { turnKey: string }).turnKey }
            : {}),
          ...memoryLabelsFrom(sse),
          createdAt: new Date().toISOString(),
        }
        const nextTab = appendMemoryProvenancePart(t, part)

        if (nextTab !== t) queueTranscriptSync(nextTab, 250)

        return nextTab
      }),
    )

    return true
  }
  if (sse.type === 'data-steering') {
    const part = parseSteeringPart(sse)

    if (!part) return true
    ctx.flushTextBuffer(streamId)
    setTabs((tabs) =>
      tabs.map((tab) => (tab.streamId === streamId ? appendSteering(tab, part) : tab)),
    )

    return true
  }
  if (sse.type === 'turn-interrupted') {
    const part: TurnInterruptedPart = {
      type: 'turn-interrupted',
      id: typeof sse.id === 'string' ? sse.id : `${streamId}:interrupted`,
      reason: normalizeTurnInterruptedReason(sse.reason),
      message: typeof sse.message === 'string' ? sse.message : '',
      createdAt: typeof sse.createdAt === 'string' ? sse.createdAt : new Date().toISOString(),
    }

    setTabs((prev) =>
      prev.map((t) => {
        if (t.streamId !== streamId) return t
        const nextTab = appendTurnInterruptedPart(t, part, uid)

        queueTranscriptSync(nextTab, 250)

        return nextTab
      }),
    )

    return true
  }
  // "The backend stopped this turn, and here is why" — the matching
  // `end` event reads it and shows the reason.
  if (sse.type === AGENT_TURN_PAUSED_EVENT) {
    const reason = typeof sse.reason === 'string' ? sse.reason : 'other'

    turnPausedRef.current.set(streamId, {
      reason,
      detail: parseStallDetail((sse as { detail?: unknown }).detail),
    })

    return true
  }
  if (sse.type === 'phase') {
    const phase = parseAgentPhase(sse.phase)
    const phaseStartedAt = eventEmittedAt(sse)

    setTabs((prev) => {
      const tab = prev.find((t) => t.streamId === streamId)

      if (!tab || tab.phase === 'stopping' || (tab.connected && tab.phase === phase)) return prev

      return prev.map((t) =>
        t.streamId === streamId ? { ...t, connected: true, phase, phaseStartedAt } : t,
      )
    })

    return true
  }
  if (sse.type === 'memory-ingest') {
    setTabs((prev) => {
      const next = prev.map((t) => {
        if (t.streamId !== streamId) return t
        if (shouldRemoveMemoryIngestFeedback(sse)) {
          const nextTab = removeMemoryIngestPart(t, memoryIngestEventId(streamId, t.sessionId, sse))

          if (nextTab !== t) queueTranscriptSync(nextTab, 250)

          return nextTab
        }
        const feedback = formatMemoryIngestFeedback(streamId, t.sessionId, sse)

        if (!feedback) return t
        const nextTab = appendMemoryIngestPart(t, feedback)

        if (nextTab !== t) queueTranscriptSync(nextTab, 250)

        return nextTab
      })

      return next
    })

    return true
  }
  if (sse.type === 'authorization-decision') {
    // Auto Mode: annotate the matching tool card with which policy
    // authorized (or required auth for) this call.
    const auth = sse as unknown as {
      toolCallId?: string
      decision?: 'allow' | 'require_auth'
      layer?: string
      reason?: string
      triggeredBy?: ToolAuthorization['triggeredBy']
      suggestedRule?: string
    }

    if (!auth.toolCallId || !auth.decision) return true
    setTabs((prev) =>
      prev.map((t) => {
        if (t.streamId !== streamId) return t

        return {
          ...t,
          messages: t.messages.map((m) => ({
            ...m,
            parts: m.parts.map((p) =>
              p.type === 'tool' && p.toolCallId === auth.toolCallId
                ? {
                    ...p,
                    authorization: {
                      decision: auth.decision!,
                      layer: auth.layer ?? '',
                      reason: auth.reason,
                      triggeredBy: auth.triggeredBy,
                      suggestedRule: auth.suggestedRule,
                    },
                  }
                : p,
            ),
          })),
        }
      }),
    )

    return true
  }

  return false
}
