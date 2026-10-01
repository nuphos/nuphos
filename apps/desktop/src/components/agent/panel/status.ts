import {
  runtimeAllows,
  runtimeSnapshotFresh,
  runtimeStatusLabel,
} from '../../../lib/runtimeExecution.ts'

import { AGENT_PHASE_LABELS } from './agentPhase.ts'
import { isAgentMemoryIngestEventItem } from './memoryIngestEvent.ts'

import type { AgentPhase } from './agentPhase.ts'
import type { AgentStatus, Message, Tab } from './model.ts'
import type { MemoryIngestPart } from './parts.ts'
import type { CSSProperties } from 'react'

export function formatMemoryIngestFeedback(
  streamId: string,
  sessionId: string,
  sse: Record<string, unknown>,
): MemoryIngestPart | null {
  const status = typeof sse.status === 'string' ? sse.status : ''
  const created = typeof sse.memoriesCreated === 'number' ? sse.memoriesCreated : 0
  const updated = typeof sse.memoriesUpdated === 'number' ? sse.memoriesUpdated : 0
  const total = Math.max(0, created) + Math.max(0, updated)
  const id =
    typeof sse.eventId === 'string' ? sse.eventId : `${sessionId || streamId}:memory-ingest`
  const createdAt = new Date().toISOString()
  const memories = Array.isArray(sse.memories)
    ? sse.memories.filter(isAgentMemoryIngestEventItem)
    : undefined
  const loaded = memories ? { memories, detailsLoadedAt: createdAt } : {}

  if (status === 'queued') return null
  if (status === 'ok') {
    const jobStatus = typeof sse.jobStatus === 'string' ? sse.jobStatus : ''

    if (jobStatus === 'succeeded' && total > 0) {
      return {
        type: 'memory-ingest',
        id,
        sessionId,
        kind: 'ok',
        text: total === 1 ? 'Memory updated' : `Memory updated (${String(total)})`,
        createdAt,
        ...loaded,
      }
    }

    return null
  }
  if (status === 'skipped') {
    return null
  }
  if (status === 'error') {
    return {
      type: 'memory-ingest',
      id,
      sessionId,
      kind: 'error',
      text: 'Memory update failed',
      createdAt,
    }
  }

  return null
}

export function shouldRemoveMemoryIngestFeedback(sse: Record<string, unknown>): boolean {
  const status = typeof sse.status === 'string' ? sse.status : ''
  const created = typeof sse.memoriesCreated === 'number' ? sse.memoriesCreated : 0
  const updated = typeof sse.memoriesUpdated === 'number' ? sse.memoriesUpdated : 0

  return status === 'queued' || status === 'skipped' || (status === 'ok' && created + updated === 0)
}

export function memoryIngestEventId(
  streamId: string,
  sessionId: string,
  sse: Record<string, unknown>,
): string {
  return typeof sse.eventId === 'string' ? sse.eventId : `${sessionId || streamId}:memory-ingest`
}

export function parseAgentPhase(value: unknown): AgentPhase | null {
  return typeof value === 'string' && value in AGENT_PHASE_LABELS ? (value as AgentPhase) : null
}

/** The failed turn already says why inline; a runtime ready for the next message is not broken. */
function failedTurnExplainedInline(
  snapshot: Tab['runtimeState'],
  lastMsg: Message | undefined,
): boolean {
  return (
    snapshot?.phase === 'interrupted' &&
    runtimeAllows(snapshot, 'send') &&
    lastMsg?.role === 'assistant' &&
    lastMsg.parts.some((part) => part.type === 'turn-interrupted')
  )
}

export function computeStatus(tab: Tab, lastMsg: Message | undefined): AgentStatus | null {
  if (!tab.sessionId || (!tab.claudeCodeRuntimeAttached && tab.messages.length === 0)) return null

  if (!tab.claudeCodeRuntimeAttached && !tab.runtimeState)
    return { label: 'Connecting…', startedAt: null }

  const snapshot = tab.runtimeState

  if (
    runtimeSnapshotFresh(snapshot) &&
    snapshot?.schemaVersion === 2 &&
    ['idle', 'dormant', 'cancelled'].includes(snapshot.phase ?? snapshot.state)
  )
    return null
  if (failedTurnExplainedInline(snapshot, lastMsg)) return null

  return { label: runtimeStatusLabel(snapshot), startedAt: null }
}

export function jsonSize(value: unknown): number {
  if (value === undefined) return 0
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    // Circular / BigInt payloads cannot be sized. This feeds a memo
    // fingerprint, so an un-sizable value simply contributes nothing.
    return 0
  }
}

// Browser-level render virtualization for long transcripts: off-screen messages
// skip layout/paint entirely, which is what keeps a huge conversation smooth
// (and lets it recover once scrolled past) without rewiring the scroll-follow
// machinery. `auto` intrinsic size caches each message's real height after its
// first paint, so the scrollbar doesn't jump. Not applied to the last message,
// so a streaming/growing tail is always measured live.
export const DEFERRED_MESSAGE_STYLE: CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 240px',
}
