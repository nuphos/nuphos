import { captureMain } from '../analytics.ts'

import { ATLAS_URL, readToken } from './http.ts'

import type { AgentCredentialSelection } from './types.ts'

export const CHAT_STREAM_RECONNECT_BASE_MS = 500
export const CHAT_STREAM_RECONNECT_MAX_MS = 5_000
export const CHAT_STREAM_RECONNECT_MAX_ATTEMPTS = 20
// Bounded budget for silent fresh restarts after a mid-stream failure (owner
// replica died, sandbox crashed, model errored, etc.). Persistent failures
// still surface to the user once the budget is exhausted.
export const CHAT_STREAM_FRESH_RETRY_MAX_ATTEMPTS = 3
export const CHAT_STREAM_FRESH_RETRY_BASE_MS = 600
export const CHAT_STREAM_FRESH_RETRY_MAX_MS = 4_000
export const CHAT_INITIAL_GATEWAY_RETRY_MAX_ATTEMPTS = 3
export const CHAT_INITIAL_GATEWAY_RETRY_BASE_MS = 700
export const CHAT_INITIAL_GATEWAY_RETRY_MAX_MS = 5_000
// First-byte deadline for each chat POST. The backend flushes SSE headers with
// an immediate heartbeat, so a healthy request answers within ~1 RTT; without
// this deadline a request blackholed by a dead connection or proxy rides
// undici's 300s default headersTimeout while the UI sits on "Connecting…".
// Timed-out attempts reconnect (resume-first) with the usual backoff, on
// their own budget like idle timeouts.
export const CHAT_STREAM_FIRST_BYTE_TIMEOUT_MS = 5_000
export const CHAT_STREAM_FIRST_BYTE_MAX_ATTEMPTS = 10
/** Escalating deadline: backs off on retries, caps at 30s. */
export function effectiveFirstByteTimeout(consecutiveTimeouts: number): number {
  return CHAT_STREAM_FIRST_BYTE_TIMEOUT_MS + Math.min(consecutiveTimeouts * 3_000, 25_000)
}
// A fresh turn's first SSE frame lands sub-second when healthy (the backend
// flushes a phase frame at run registration), so a still-frameless turn this
// far in means a stalled or blackholed transport. Beacon it server-side even
// though the retries may yet recover it — a self-healed stall is otherwise
// invisible to alerting.
export const CHAT_STREAM_CONNECT_STALL_BEACON_MS = 15_000
export const AGENT_STREAM_DONE_EVENT = 'atlas-stream-done'
export const AGENT_TURN_COMPLETE_EVENT = 'atlas-turn-complete'
// Silence (no frames, not even the ~5s heartbeat) past this means the stream
// is dead; must stay well above the backend's 5s heartbeat interval.
export const CHAT_STREAM_IDLE_TIMEOUT_MS = 45_000
// The idle timer above treats ANY bytes as life, heartbeats included — which is
// exactly how a run whose producer died stays "healthy" forever: the backend
// keeps heartbeating a stream that will never carry another frame, so the
// transport never reconnects and never errors, and the user watches a turn that
// is already over. This second, much longer deadline is reset only by real SSE
// frames, so it is the one that can tell "slow" apart from "gone". It must stay
// above the longest legitimate gap between frames (a long tool call still emits
// tool_call_update frames, and the backend's own prompt cap is ~32min).
export const CHAT_STREAM_NO_CONTENT_TIMEOUT_MS = 40 * 60_000
// A dead backend idles out on every reconnect too, so cap idle timeouts on
// their own small budget — surface an error in ~3×45s instead of riding the
// full 20-slot transport reconnect budget (~15min).
export const CHAT_STREAM_IDLE_MAX_ATTEMPTS = 3

export type StartChatArgs = {
  streamId: string
  sessionId: string
  teamId?: string
  messages: unknown[]
  /** Absolute transcript index of messages[0] when the tab holds only a
   *  paginated tail; the backend hydrates the stored prefix. */
  baseIndex?: number
  locale?: string
  url?: string
  kubeContext?: string
  diagramId?: string
  resume?: boolean
  resumeFrom?: number
  // Set by the renderer when auto-resuming a stream that ended without an
  // atlas-turn-complete signal. Forwarded straight through to the backend so
  // it can inject a "continue from where you left off" system message.
  continueAfterInterruption?: boolean
  // Why the turn is being continued. 'permission-decision' = an admin just
  // approved/rejected an inline permission proposal via HITL; forwarded so the
  // backend reframes the continuation nudge (clean pause, not an interruption).
  resumeReason?: 'permission-decision' | 'approval-decision' | 'client-tool'
  credentialAccess?: AgentCredentialSelection
  // The authorization mode the composer was set to when this conversation was
  // started. The backend honours it only while creating the conversation, so
  // it is harmless on later turns — but see the renderer: it stops sending it
  // once the session exists, rather than relying on that.
  permissionMode?: 'auto' | 'bypass'
  agentRuntime?: 'claude-code' | 'codex'
  runtimeId?: string
}

export type ChatStreamState = {
  aborted: boolean
  completedSuccessfully: boolean
  resumeFrom: number
  reconnectAttempts: number
  continuationAccepted: boolean
  idleTimeouts: number
  firstByteTimeouts: number
  terminalEventDetected: boolean
  forceFreshStart: boolean
  usedFreshStartFallback: boolean
  freshRetryAttempts: number
  initialGatewayRetryAttempts: number
  toolExecutionMayHaveStarted: boolean
  // Suffix-window protocol: the POST carries only the tail from the
  // latest user message with `baseIndex` advanced accordingly. Set once the
  // backend rejects that window with 409 transcript_out_of_sync — the next
  // attempt (and every later one this turn) sends the untrimmed transcript.
  sendFullTranscript: boolean
  // The server's stored message count from a 409 transcript_out_of_sync
  // rejection. When set, the next windowed attempt claims this as its
  // baseIndex ("rebase onto the server's count") instead of the local
  // arithmetic — recovers sessions whose local count drifted from the store
  // without resending the full transcript, which can exceed the ingress
  // body limit. One attempt only; a second 409 falls back to the full
  // transcript.
  rebaseBaseIndex: number | undefined
}

export type ChatStreamCtx = {
  streamId: string
  sessionId: string
  teamId?: string
  explicitResume: boolean
  signal: AbortSignal
  emit: (event: unknown) => void
  noteFirstFrame: () => void
  state: ChatStreamState
}

export function createChatStreamState(resumeFrom: number): ChatStreamState {
  return {
    aborted: false,
    completedSuccessfully: false,
    resumeFrom,
    reconnectAttempts: 0,
    // True once a continuation POST was ACCEPTED by the backend (res.ok). Gates
    // dropping continueAfterInterruption/resumeReason: a retry after a fetch that
    // never reached the backend must still carry them; only re-sending into an
    // already-accepted run must not re-inject the nudge.
    continuationAccepted: false,
    idleTimeouts: 0,
    firstByteTimeouts: 0,
    terminalEventDetected: false,
    forceFreshStart: false,
    usedFreshStartFallback: false,
    freshRetryAttempts: 0,
    initialGatewayRetryAttempts: 0,
    // Sticky for this user turn. A later transport/model failure must never
    // restart the full request after a tool may have begun: that would replay
    // trigger/provider writes even if the failed response never reached us.
    toolExecutionMayHaveStarted: false,
    sendFullTranscript: false,
    rebaseBaseIndex: undefined,
  }
}

// Beacon a terminal client-side failure (auto-resume exhausted, etc.) to the
// backend so the give-up is recorded server-side (stdout + OTel + Braintrust).
// Best-effort and fire-and-forget — telemetry must never block the UI.
export function reportFailure(streamId: string, payload: Record<string, unknown>): void {
  void (async () => {
    const token = await readToken()

    if (!token) return
    try {
      await fetch(`${ATLAS_URL}/agent/chat/${encodeURIComponent(streamId)}/report-failure`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch {
      // Best effort: the failure is already surfaced + reported to PostHog.
    }
  })()
}

/**
 * One breadcrumb per transition in a chat stream's life.
 *
 * This layer — the only one that actually issues the POST, retries it, and
 * times it out — had no telemetry of any kind. A turn that died here produced
 * silence in every surface at once: the backend never saw a request, and the
 * renderer only reports once it gives up, which a stuck turn never does. That
 * is how a 3m40s hang came to have no root cause.
 *
 * Everything goes to PostHog (batched, cheap). `beacon` additionally POSTs to
 * the backend so the breadcrumb lands in the same Tempo trace as the
 * server-side turn — reserved for transitions that mean something is wrong,
 * because each one is its own HTTP request.
 */
export function traceStream(
  event: string,
  ctx: { streamId: string; sessionId: string },
  properties?: Record<string, unknown>,
  beacon?: 'info' | 'warn',
): void {
  captureMain('agent_stream_lifecycle', {
    phase: event,
    stream_id: ctx.streamId,
    session_id: ctx.sessionId,
    ...properties,
  })
  if (beacon) {
    reportFailure(ctx.streamId, {
      sessionId: ctx.sessionId,
      phase: event,
      level: beacon,
      message: `agent stream: ${event}`,
      detail: properties ?? null,
    })
  }
}
