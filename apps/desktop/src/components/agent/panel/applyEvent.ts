import { normalizeAgentError, uid } from './stall.ts'
import { appendTextDelta } from './streamText.ts'
import { applyToolOutputDelta } from './toolOutputDelta.ts'
import { eventEmittedAt } from './sessionContinuity.ts'
import { updateCurrentAssistantParts } from './turnBoundaries.ts'

import type { Tab } from './model.ts'
import type { MemoryIngestPart, MemoryProvenancePart, Part } from './parts.ts'
import type { Plan, PlanLifecycleStatus } from '../../../api'

export type ActivePlan = {
  /** toolCallId of the Plan-producing part (so the inline copy can suppress its action bar) */
  toolCallId: string
  /** id of the persisted Plan doc */
  planId: string
  /** The DB plan document — source of truth for status + per-command progress. */
  plan: Plan
}

export const ACTIVE_LIFECYCLE_STATUSES: ReadonlySet<PlanLifecycleStatus> = new Set([
  'proposed',
  'approved',
  'executing',
])

// The propose_permission_grant tool returns `{ proposalId, status, summary }`.
export function extractProposalIdFromOutput(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null
  const o = output as Record<string, unknown>

  return typeof o.proposalId === 'string' && o.proposalId.length > 0 ? o.proposalId : null
}

export function applyEvent(parts: Part[], event: Record<string, unknown>): Part[] {
  const type = event.type as string | undefined

  if (!type) return parts
  const emittedAt = eventEmittedAt(event)

  // Text streaming: positional append. text-start opens a new text part; text-delta extends
  // the last text part (creating one if the last part is a tool / nothing). text-end is a no-op
  // (the next text-start opens a fresh part).
  if (type === 'text-start') {
    return [...parts, { type: 'text', text: '' }]
  }
  if (type === 'text-delta') {
    const delta =
      [event.delta, event.text, event.content, event.textDelta].find(
        (value): value is string => typeof value === 'string' && value.length > 0,
      ) ?? ''

    return appendTextDelta(parts, delta)
  }
  if (type === 'text-end') return parts

  // Reasoning streams like text but into its own part type.
  if (type === 'reasoning-start') {
    return [...parts, { type: 'reasoning', text: '', startedAt: emittedAt }]
  }
  if (type === 'reasoning-delta') {
    const delta =
      [event.delta, event.text].find(
        (value): value is string => typeof value === 'string' && value.length > 0,
      ) ?? ''

    if (!delta) return parts
    const last = parts[parts.length - 1]

    if (last?.type === 'reasoning') {
      const next = parts.slice()

      next[parts.length - 1] = {
        ...last,
        text: last.text + delta,
        startedAt: last.startedAt ?? emittedAt,
      }

      return next
    }

    return [...parts, { type: 'reasoning', text: delta, startedAt: emittedAt }]
  }
  if (type === 'reasoning-end') {
    const index = parts.findLastIndex((part) => part.type === 'reasoning')

    if (index < 0) return parts
    const next = parts.slice()
    const reasoning = next[index]

    if (reasoning?.type === 'reasoning') next[index] = { ...reasoning, completedAt: emittedAt }

    return next
  }

  if (type === 'start-step') {
    return [...parts, { type: 'step-start' }]
  }
  if (type === 'finish-step') return parts

  if (type === 'tool-input-start') {
    const toolCallId = event.toolCallId as string
    const toolName = (event.toolName as string) ?? 'tool'

    if (parts.some((p) => p.type === 'tool' && p.toolCallId === toolCallId)) return parts

    return [
      ...parts,
      { type: 'tool', toolCallId, toolName, state: 'input-streaming', startedAt: emittedAt },
    ]
  }
  if (type === 'tool-input-available') {
    const toolCallId = event.toolCallId as string
    const toolName = (event.toolName as string) ?? undefined

    if (!parts.some((p) => p.type === 'tool' && p.toolCallId === toolCallId)) {
      return [
        ...parts,
        {
          type: 'tool',
          toolCallId,
          toolName: toolName ?? 'tool',
          state: 'input-available',
          startedAt: emittedAt,
          input: event.input,
        },
      ]
    }

    return parts.map((p) =>
      p.type === 'tool' && p.toolCallId === toolCallId
        ? {
            ...p,
            toolName: toolName ?? p.toolName,
            state: 'input-available',
            startedAt: p.startedAt ?? emittedAt,
            input: event.input,
          }
        : p,
    )
  }
  if (type === 'tool-approval-request') {
    // Native HITL: the SDK paused this tool call awaiting the user's decision.
    // Move the matching card into approval-requested; the render shows the
    // approve/deny buttons and the resubmit carries the response back.
    const toolCallId = event.toolCallId as string
    const approvalId = event.approvalId as string
    const signature = event.signature as string | undefined
    const source = event.source === 'openab' ? ('openab' as const) : undefined

    return parts.map((p) =>
      p.type === 'tool' && p.toolCallId === toolCallId
        ? {
            ...p,
            state: 'approval-requested',
            approval: { id: approvalId, signature, ...(source ? { source } : {}) },
          }
        : p,
    )
  }
  if (type === 'tool-output-delta') {
    return applyToolOutputDelta(parts, event)
  }
  if (type === 'tool-output-available') {
    const toolCallId = event.toolCallId as string

    return parts.map((p) =>
      p.type === 'tool' && p.toolCallId === toolCallId
        ? {
            ...p,
            state: 'output-available',
            output: event.output,
            liveOutput: undefined,
            completedAt: p.completedAt ?? emittedAt,
          }
        : p,
    )
  }
  if (type === 'tool-output-error') {
    const toolCallId = event.toolCallId as string
    const errorText = normalizeAgentError((event.errorText as string) ?? 'Tool error')

    return parts.map((p) =>
      p.type === 'tool' && p.toolCallId === toolCallId
        ? {
            ...p,
            state: 'output-error',
            liveOutput: undefined,
            completedAt: p.completedAt ?? emittedAt,
            errorText,
          }
        : p,
    )
  }

  return parts
}

export function appendMemoryIngestPart(
  tab: Tab,
  part: MemoryIngestPart,
  targetMessageId?: string,
): Tab {
  const messages = tab.messages.slice()
  let assistantIndex = targetMessageId
    ? messages.findIndex((message) => message.id === targetMessageId)
    : messages.length - 1
  let assistant = messages[assistantIndex]

  if (assistant?.role !== 'assistant') {
    // A delayed post-stream result must never drift onto a newer turn if its
    // original assistant message has since disappeared.
    if (targetMessageId) return tab
    assistant = { id: uid(), role: 'assistant', parts: [] }
    messages.push(assistant)
    assistantIndex = messages.length - 1
  }
  const existingIndex = assistant.parts.findIndex(
    (p) => p.type === 'memory-ingest' && p.id === part.id,
  )

  if (existingIndex >= 0) {
    const existing = assistant.parts[existingIndex]

    if (existing.type !== 'memory-ingest') return tab
    const nextParts = assistant.parts.slice()

    nextParts[existingIndex] = {
      ...existing,
      ...part,
      memories: part.memories ?? existing.memories,
      detailsLoadedAt: part.detailsLoadedAt ?? existing.detailsLoadedAt,
    }
    messages[assistantIndex] = { ...assistant, parts: nextParts }

    return { ...tab, connected: true, messages }
  }
  messages[assistantIndex] = {
    ...assistant,
    parts: [...assistant.parts, part],
  }

  return { ...tab, connected: true, messages }
}

// ADR-0007 #2: attach/replace the provenance footer on the current answer.
export function appendMemoryProvenancePart(tab: Tab, part: MemoryProvenancePart): Tab {
  const messages = updateCurrentAssistantParts(tab.messages, uid, (parts) => [
    ...parts.filter((p) => !(p.type === 'memory-provenance' && p.id === part.id)),
    part,
  ])

  return { ...tab, connected: true, messages }
}

export function removeMemoryIngestPart(tab: Tab, partId: string): Tab {
  let changed = false
  const messages = tab.messages.flatMap((message) => {
    if (message.role !== 'assistant') return [message]
    const parts = message.parts.filter(
      (part) => part.type !== 'memory-ingest' || part.id !== partId,
    )

    if (parts.length === message.parts.length) return [message]
    changed = true
    if (parts.length === 0) return []

    return [{ ...message, parts }]
  })

  return changed ? { ...tab, messages } : tab
}
