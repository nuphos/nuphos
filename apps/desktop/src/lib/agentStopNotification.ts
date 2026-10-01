// The native notification fired when an agent turn stops.
//
// "A stream ended" is not "the turn stopped": a transport drop and a
// client-side tool handoff both close a stream that the renderer immediately
// continues with a fresh streamId. Only the end handler knows which of those
// it is, so the notification is decided there — and every stop it
// notifies about must answer, on its own, why the agent stopped. A clean finish
// carries the answer; an approval gate and a failure carry their reason.

import { toGraphemes } from './graphemes.ts'

const NOTIFICATION_MAX_CHARS = 200

export type AgentStopOutcome =
  // The backend sent atlas-turn-complete: either the answer, or the turn parked
  // on an approval gate (the backend emits a clean turn-complete there too, so
  // the client waits for the user instead of auto-resuming).
  | { kind: 'finished' }
  // Errored mid-stream, or the renderer exhausted its continuation budget.
  | { kind: 'failed'; cause: string }
  // The stream outlived the surface that started it — opening another
  // conversation replaces the tab without aborting the run. Nothing is left to
  // continue it, so the end is a stop, but its transcript is no longer in
  // memory: the caller refetches the persisted one, and falls back to a
  // generic sentence when it cannot.
  | { kind: 'ended-while-closed' }

// Structural shape of a transcript message — the panel's own Message/Part types
// are assignable to it, which keeps this module free of the panel's imports.
export type StopNotificationPart = {
  type: string
  text?: string
  toolName?: string
  state?: string
}
export type StopNotificationMessage = {
  role: string
  parts: readonly StopNotificationPart[]
}

export function stripMarkdown(input: string): string {
  let s = input

  // Fenced code blocks: collapse to a [code] marker — the raw source is noise
  // in a toast notification.
  s = s.replace(/```[^`]*(?:`(?!``)[^`]*)*```/g, '[code]')
  // Images: ![alt](url) -> alt
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  // Links: [text](url) -> text
  s = s.replace(/\[([^[\]]*)\]\([^)]*\)/g, '$1')
  // Inline code: `code` -> code
  s = s.replace(/(?=(`+))\1([^`]+)`+/g, '$2')
  // Bold/italic: **x**, __x__, *x*, _x_, ~~x~~
  s = s.replace(/(\*\*|__)(.*?)\1/g, '$2')
  s = s.replace(/([*_])(.*?)\1/g, '$2')
  s = s.replace(/~~(.*?)~~/g, '$1')
  // Headings, blockquotes, list markers at line starts.
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  s = s.replace(/^\s{0,3}>\s?/gm, '')
  s = s.replace(/^[ \t]*([-*+]|\d+\.)[ \t]+/gm, '')
  // Horizontal rules.
  s = s.replace(/^[ \t]*([-*_])\1{2,}[ \t]*$/gm, '')
  // Collapse whitespace.
  s = s.replace(/\s+/g, ' ').trim()

  return s
}

function lastAssistantMessage(
  messages: readonly StopNotificationMessage[],
): StopNotificationMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]

    if (m?.role === 'assistant') return m
  }

  return null
}

/** The last run of text before `endExclusive`. An assistant message accumulates
 *  every step of the turn, so a tool call or a thinking block bounds the text
 *  that belongs to this step; step boundaries and memory chips sit between text
 *  parts and are skipped rather than treated as boundaries. */
function assistantTextEndingAt(
  parts: readonly StopNotificationPart[],
  endExclusive: number,
): string {
  const chunks: string[] = []

  for (let i = endExclusive - 1; i >= 0; i -= 1) {
    const part = parts[i]

    if (!part) continue
    if (part.type === 'tool' || part.type === 'reasoning') break
    if (part.type === 'text' && part.text) chunks.unshift(part.text)
  }

  return stripMarkdown(chunks.join(''))
}

/** The answer the user is waiting for: the text after the turn's last tool call,
 *  not the narration that preceded it. */
export function finalAssistantText(messages: readonly StopNotificationMessage[]): string {
  const message = lastAssistantMessage(messages)

  if (!message) return ''

  return assistantTextEndingAt(message.parts, message.parts.length)
}

/** Set when the turn parked on a native HITL gate — the agent stopped because it
 *  is waiting for this tool call to be approved or denied. The text carried
 *  alongside is the model's own explanation of what it wants to do, which sits
 *  just BEFORE the gate (nothing follows it). */
function pendingApproval(
  messages: readonly StopNotificationMessage[],
): { toolName: string; text: string } | null {
  const message = lastAssistantMessage(messages)

  if (!message) return null
  for (let i = message.parts.length - 1; i >= 0; i -= 1) {
    const part = message.parts[i]

    if (part?.type === 'tool' && part.state === 'approval-requested') {
      return {
        toolName: part.toolName || 'a command',
        text: assistantTextEndingAt(message.parts, i),
      }
    }
  }

  return null
}

export function pendingApprovalTool(messages: readonly StopNotificationMessage[]): string | null {
  return pendingApproval(messages)?.toolName ?? null
}

function truncate(text: string): string {
  const chars = toGraphemes(text)

  if (chars.length <= NOTIFICATION_MAX_CHARS) return text

  return `${chars.slice(0, NOTIFICATION_MAX_CHARS).join('')}…`
}

/** `messages` is only read for a finished turn — a failure states its cause, so
 *  callers that have nothing but the error can omit the transcript. */
export function buildAgentStopNotification(args: {
  outcome: AgentStopOutcome
  title?: string
  messages?: readonly StopNotificationMessage[]
}): { title: string; body: string } {
  const { outcome, title, messages = [] } = args

  return {
    title: title?.trim() || 'Nuphos',
    body: truncate(stopNotificationBody(outcome, messages)),
  }
}

/** Why the last turn stopped, read from the transcript alone: the approval it
 *  is waiting for, or the answer it gave. Null when the transcript does not say
 *  (no assistant text after the last tool call). */
export function describeStoppedTurn(messages: readonly StopNotificationMessage[]): string | null {
  const approval = pendingApproval(messages)

  if (approval) {
    const reason = `Waiting for your approval: ${approval.toolName}`

    return approval.text ? `${reason}\n${approval.text}` : reason
  }

  return finalAssistantText(messages) || null
}

function stopNotificationBody(
  outcome: AgentStopOutcome,
  messages: readonly StopNotificationMessage[],
): string {
  if (outcome.kind === 'ended-while-closed') {
    // The transcript, when the caller could fetch it from the backend, answers
    // the question the same way an open conversation's would.
    return (
      describeStoppedTurn(messages) ??
      'The agent stopped while this conversation was closed — open it to see what happened.'
    )
  }
  if (outcome.kind === 'failed') {
    // Turn-level errors carry a machine-readable `context=…` line for the error
    // box and telemetry; a notification gets the human sentence only.
    const cause = outcome.cause.split('\n')[0]?.trim()

    return cause || 'The agent stopped with an error.'
  }

  return describeStoppedTurn(messages) ?? 'The agent finished without a text response.'
}

/** OS-visible status without conversation titles, answers, tool names or errors. */
export function buildAgentStatusNotification(args: {
  failed: boolean
  messages: readonly StopNotificationMessage[]
}): { title: string; body: string } {
  let body = 'Agent finished. Open Nuphos to view the response.'

  if (args.failed) body = 'Agent stopped before finishing. Open Nuphos for details.'
  else if (pendingApprovalTool(args.messages)) body = 'Agent needs your approval.'

  return { title: 'Nuphos', body }
}
