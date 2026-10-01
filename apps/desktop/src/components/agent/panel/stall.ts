import { Bug, FileSearch, Shield, Terminal } from 'lucide-react'

import { isNetworkError } from '../../../api'
import { reportFrontendError } from '../../../lib/frontendErrorReporter'
import { markOwnedAgentStream } from '../../../lib/ownedAgentStreams'

import { SANDBOX_EXPIRED_MESSAGE } from './constants'

import type { Message } from './model'
import type { ToolPart } from './parts'

export function normalizeAgentError(message: string): string {
  // The electron layer appends a "\ncontext=phase=…streamId=…" diagnostic tail
  // (formatAgentLocalError) for logs/telemetry — it must never reach the user's
  // error banner. Strip it before anything else; the main-process logs and the
  // IPC channel still carry the full context for debugging.
  const base = message.split('\ncontext=')[0].trim()
  const normalized = base.toLowerCase()

  // AI_MissingToolResultsError: the transcript carries a tool call with
  // neither a result nor an approval decision — in practice a command that
  // was still waiting for approval when something else happened (session
  // 3c2e03db). The raw SDK message ("Tool result is missing for tool call
  // tooluse_…") gives the user nothing to act on.
  if (normalized.includes('tool result') && normalized.includes('missing')) {
    return 'A previous command was never resolved — it is likely still waiting for your approval. Scroll up and approve or deny it, then send your message again.'
  }
  // A transient connectivity loss (backend restart/redeploy, offline, or the
  // stream's reconnect budget exhausting) surfaces as "fetch failed". Show a
  // calm, recoverable message rather than the raw fetch error — the backend
  // usually kept running, so a retry (or reopening the chat) recovers.
  if (isNetworkError(base)) {
    return 'Lost connection to the server. Your work is safe — check your connection and try again.'
  }
  const mentionsSandbox = normalized.includes('sandbox')
  const isSandboxTeardown =
    mentionsSandbox &&
    (normalized.includes('terminated') ||
      normalized.includes('stopped') ||
      normalized.includes('aborted') ||
      normalized.includes('expired'))

  if (normalized.includes('sandboxexpirederror') || isSandboxTeardown) {
    return SANDBOX_EXPIRED_MESSAGE
  }

  return base
}

let uidFallbackSeq = 0

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  // Without Web Crypto the ids only have to be unique inside this renderer, so
  // a monotonic counter is both cheaper and stronger than a random string.
  uidFallbackSeq += 1

  return `uid-${Date.now().toString(36)}-${uidFallbackSeq.toString(36)}`
}

/** A stream id for a run this device starts, and therefore owns. */
export function newAgentStreamId(): string {
  const streamId = uid()

  markOwnedAgentStream(streamId)

  return streamId
}

export const PRESETS = [
  {
    icon: FileSearch,
    title: 'Investigate a CrashLoopBackOff',
    prompt: 'Why is my pod stuck in CrashLoopBackOff and how do I fix it?',
  },
  {
    icon: Terminal,
    title: 'Tail logs across pods',
    prompt: 'Show me logs across all pods of a deployment, filter by level=error.',
  },
  {
    icon: Bug,
    title: 'Diagnose a flaky service',
    prompt: 'A service is intermittently 502-ing. Walk me through diagnosing it.',
  },
  {
    icon: Shield,
    title: 'Review security posture',
    prompt: 'Audit the security groups and NACLs in my AWS account for risks.',
  },
]

export const INTERRUPTED_TOOL_MESSAGE = 'Interrupted before the tool finished.'
// A tool call whose input never finished streaming (`input-streaming`) never
// fully materialized — the model stalled mid-emission and the silence watchdog
// aborted the turn. Distinguish it from a complete tool call that started and
// got interrupted, which "Interrupted before the tool finished" implies.
export const INCOMPLETE_TOOL_MESSAGE = "The model didn't finish generating this tool call."

// Refine the generic interrupted message per tool-part state; leave explicit
// reasons (Stopped by user, a stream error) untouched.
export function incompleteToolErrorText(part: ToolPart, errorText: string): string {
  if (errorText !== INTERRUPTED_TOOL_MESSAGE) return errorText

  return part.state === 'input-streaming' ? INCOMPLETE_TOOL_MESSAGE : INTERRUPTED_TOOL_MESSAGE
}

// Model-only corrective nudge: when a resume follows a tool call that
// never finished streaming, tell the model to re-issue a complete call instead
// of replaying the half-open one (which just re-stalls, burning continuations).
// Injected into the resume payload only — never persisted or shown, like the
// backend's continuation text.
export const INCOMPLETE_TOOL_RESUME_NUDGE =
  '[automatic continuation — not typed by the user] The previous turn began a tool call but did not ' +
  'emit a complete invocation before the stream stalled. Re-issue exactly one complete tool call with all ' +
  'required arguments, or respond in text. Do not try to resume the partial call.'

// True when the last assistant message ends on a never-materialized tool call
// (finalized to INCOMPLETE_TOOL_MESSAGE) — the model stalled mid-emission.
// Checks the last model-visible part (text or tool), not just `some`, so a turn
// that recovered with newer text or a complete call no longer re-triggers the
// nudge/telemetry on every following continuation.
export function lastMessageHasIncompleteToolCall(messages: Message[]): boolean {
  const last = messages[messages.length - 1]

  if (last?.role !== 'assistant') return false
  const lastModelPart = [...last.parts]
    .reverse()
    .find((p) => p.type === 'text' || p.type === 'tool')

  return (
    lastModelPart?.type === 'tool' &&
    lastModelPart.state === 'output-error' &&
    lastModelPart.errorText === INCOMPLETE_TOOL_MESSAGE
  )
}

// The structured cause chain the backend attaches to an atlas-turn-paused frame
// (mirrors buildPauseDetail in apps/backend/src/routes/agent.ts). Every field is
// optional — older backends and finish-reason pauses send a subset.
export type StallDetail = {
  reason?: string
  streamId?: string
  stallPhase?: string
  stallTimeoutMs?: number
  noFrameMs?: number
  lastFrameType?: string | null
  toolName?: string | null
  toolCallId?: string | null
  forwardedFrames?: number
  elapsedMs?: number
  lastFinishReason?: string | null
  watchdogTriggered?: boolean
}

export function parseStallDetail(raw: unknown): StallDetail | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined

  return raw
}

export const secs = (ms: number | undefined): string =>
  typeof ms === 'number' && Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : '?s'

// Turn a paused/interrupted turn into a human sentence that traces to the real
// root cause. Design principle: the customer must never see a bare "interrupted"
// — the UI may collapse this, but the cause must always be reachable.
export function describeStallCause(reason: string, detail?: StallDetail): string {
  const tool = detail?.toolName ? `\`${detail.toolName}\`` : 'a tool'

  switch (reason) {
    case 'model-silence': {
      const where =
        detail?.stallPhase === 'tool-input'
          ? `while streaming the input for ${tool}`
          : detail?.stallPhase === 'reasoning'
            ? 'while thinking'
            : detail?.stallPhase === 'generating'
              ? 'while generating its response'
              : 'while we waited for its next output'

      return (
        `The model stopped sending data for ${secs(detail?.noFrameMs)} ${where} ` +
        `(watchdog limit ${secs(detail?.stallTimeoutMs)}, phase: ${detail?.stallPhase ?? 'unknown'}), ` +
        `so the turn was stopped.`
      )
    }
    case 'tool-execution-timeout': {
      const subject = detail?.toolName ? `The ${tool} tool` : 'A tool'

      return (
        `${subject} ran for ${secs(detail?.noFrameMs)} ` +
        `without producing output (limit ${secs(detail?.stallTimeoutMs)}), so the turn was stopped.`
      )
    }
    case 'output-budget':
      return 'The turn hit its maximum output length and stopped mid-message.'
    case 'turn-deadline':
      return 'The turn ran past the time limit for an unattended run and was stopped.'
    case 'content-filter':
      return 'The response was stopped by a content filter.'
    default:
      return `The turn stopped (${reason}).`
  }
}

// One-line diagnostic suffix so the full chain is greppable in logs/telemetry
// even when the friendly sentence is shown collapsed.
export function stallContextLine(
  detail: StallDetail | undefined,
  streamId: string | null,
  sessionId: string,
): string {
  return (
    `context=streamId=${detail?.streamId ?? streamId ?? 'unknown'} sessionId=${sessionId} ` +
    `reason=${detail?.reason ?? 'unknown'} stallPhase=${detail?.stallPhase ?? 'unknown'} ` +
    `noFrameMs=${String(detail?.noFrameMs ?? '?')} stallTimeoutMs=${String(detail?.stallTimeoutMs ?? '?')} ` +
    `lastFrameType=${detail?.lastFrameType ?? '?'} toolName=${detail?.toolName ?? '?'} ` +
    `elapsedMs=${String(detail?.elapsedMs ?? '?')}`
  )
}

// Beacon a terminal turn failure to the backend so the give-up is recorded
// server-side too (the backend pump only ever saw recoverable pauses). No-op
// when we have no streamId to correlate. Best-effort.
export function reportAgentFailureToBackend(payload: {
  streamId: string | null
  sessionId: string
  phase: string
  message: string
  pausedReason: string | null
  autoResumeAttempts: number
  detail: StallDetail | null
}): void {
  const { streamId } = payload

  if (!streamId) return
  // Telemetry must never break the error path, so the call goes through a
  // microtask: that turns a synchronous bridge throw (uncloneable payload)
  // into a rejection the `.catch` below swallows along with a real one.
  void Promise.resolve()
    .then(() =>
      window.api.agentReportFailure(streamId, payload as unknown as Record<string, unknown>),
    )
    .catch((cause: unknown) => {
      reportFrontendError(
        {
          source: 'agent_failure_reporting',
          phase: 'backend_report_failed',
          message: 'Could not report an Agent failure to the backend.',
          streamId,
          sessionId: payload.sessionId,
        },
        cause,
      )
    })
}
