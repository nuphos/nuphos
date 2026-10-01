// Pure helpers shared by the journal side panel and the audit
// log page. No React here — the shared components live in
// components/agent/JournalEventBody.tsx.

import { CircleDot, KeyRound, MessageSquare, Terminal } from 'lucide-react'

import { journalContentText } from './journalEventText.ts'

import type { AgentJournalEvent } from '../api'
import type { LucideIcon } from 'lucide-react'

/** Anchor shared with the chat transcript (data-message-id / data-tool-call-id). */
export type JournalChatTarget = { messageId?: string; toolCallId?: string }

/** Which chat element this event corresponds to (if any). */
export function journalEventChatTarget(event: AgentJournalEvent): JournalChatTarget | null {
  if (event.session.toolCallId) return { toolCallId: event.session.toolCallId }
  const idParts = event.eventId.split('|')

  if (event.type === 'user_message' || event.type === 'assistant_message') {
    return idParts[2] ? { messageId: idParts[2] } : null
  }
  if (event.type === 'client_tool_result') {
    return idParts[3] ? { toolCallId: idParts[3] } : idParts[2] ? { messageId: idParts[2] } : null
  }

  return null
}

export function journalEventIcon(type: string): LucideIcon {
  if (type.startsWith('tool_call') || type === 'client_tool_result') return Terminal
  if (type.endsWith('_message')) return MessageSquare
  if (type === 'credential_grant' || type === 'user_approval') return KeyRound

  return CircleDot
}

export type ParsedIntent = { label: string | null; command: string | null; rest: string }

/** inputRedacted is the redacted canonical JSON of the tool input (incl. the model's label). */
export function parseIntentInput(payload: Record<string, unknown>): ParsedIntent {
  const raw = typeof payload.inputRedacted === 'string' ? payload.inputRedacted : ''

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const label = typeof parsed.label === 'string' ? parsed.label : null
    const command = typeof parsed.command === 'string' ? parsed.command : null
    const restEntries = Object.entries(parsed).filter(([k]) => k !== 'label' && k !== 'command')

    return {
      label,
      command,
      rest: restEntries.length > 0 ? JSON.stringify(Object.fromEntries(restEntries)) : '',
    }
  } catch {
    return { label: null, command: null, rest: raw }
  }
}

export { journalReasoningText, reasoningByToolCall } from './journalEventText.ts'
export { journalContentText }
export { groupJournalEvents } from './journalEventTimeline.ts'
export type { JournalTimelineItem } from './journalEventTimeline.ts'

export function formatJournalTs(ts: string): string {
  const date = new Date(ts)

  return Number.isNaN(date.getTime()) ? ts : date.toLocaleTimeString()
}

/** Fixed-width 24h clock for the timeline gutter (locale clocks vary too much to column-align). */
export function formatJournalClock(ts: string): string {
  const date = new Date(ts)

  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('en-GB', { hour12: false })
}

/** AWS-investigation-timeline style offset: +26s, +2m14s, +1h03m. */
export function formatRelativeJournalTs(ts: string, baseTs: string): string {
  const t = Date.parse(ts)
  const base = Date.parse(baseTs)

  if (Number.isNaN(t) || Number.isNaN(base)) return ''
  const seconds = Math.max(0, Math.round((t - base) / 1000))

  if (seconds < 60) return `+${String(seconds)}s`
  const minutes = Math.floor(seconds / 60)

  if (minutes < 60) return `+${String(minutes)}m${String(seconds % 60).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)

  return `+${String(hours)}h${String(minutes % 60).padStart(2, '0')}m`
}

/**
 * Tool outputs are journaled as a redacted canonical-JSON preview (400 chars).
 * For the common bash shape, parse it back so the UI can render stdout/stderr
 * and the exit code like the transcript's command card. Truncated previews
 * fail JSON.parse and fall back to the raw string.
 */
export type ParsedToolOutput = {
  exitCode: number | null
  stdout: string | null
  stderr: string | null
  raw: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Payload fields arrive as `unknown`; a non-string one has no useful text. */
function payloadText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

export function parseToolOutputPreview(payload: Record<string, unknown>): ParsedToolOutput {
  const raw = typeof payload.outputPreview === 'string' ? payload.outputPreview.trim() : ''

  try {
    const parsed: unknown = JSON.parse(raw)

    if (!isRecord(parsed)) throw new Error('not an object')

    return {
      exitCode: typeof parsed.exitCode === 'number' ? parsed.exitCode : null,
      stdout: typeof parsed.stdout === 'string' ? parsed.stdout : null,
      stderr: typeof parsed.stderr === 'string' ? parsed.stderr : null,
      raw,
    }
  } catch {
    return { exitCode: null, stdout: null, stderr: null, raw }
  }
}

/** One-line human summary — used by compact audit rows. */
export function journalEventSummary(event: AgentJournalEvent): string {
  const payload = (event.payload ?? {}) as Record<string, unknown>

  switch (event.type) {
    case 'turn_start':
      return 'Turn started'
    case 'turn_end':
      return 'Turn finished'
    case 'user_message':
      return journalContentText(event.contentHot) || 'User message (content hash)'
    case 'assistant_message':
      return journalContentText(event.contentHot) || 'Assistant message (content hash)'
    case 'tool_call_intent': {
      const intent = parseIntentInput(payload)

      return intent.label ?? intent.command ?? `${payloadText(payload.toolName, 'tool')} call`
    }
    case 'tool_call_result': {
      const ok = payload.success === true

      return `${payloadText(payload.toolName, 'tool')} ${ok ? 'succeeded' : 'FAILED'}`
    }
    case 'client_tool_result':
      return `${payloadText(payload.toolName, 'local tool')} result (desktop)`
    case 'credential_grant':
      return 'Credentials granted'
    case 'user_approval': {
      const planNumber = payload.planNumber

      if (typeof planNumber === 'number') {
        return `Plan #${String(planNumber)} ${payload.decision === 'rejected' ? 'rejected' : 'approved'}`
      }

      return 'User approval'
    }
    default:
      return event.type
  }
}
