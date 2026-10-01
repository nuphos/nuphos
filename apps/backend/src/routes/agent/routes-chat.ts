import { randomUUID } from 'node:crypto'

import { logSpanError, startTraceSpan } from '@/lib/agent/braintrust'
import { requestAgentRunCancellation } from '@/lib/agent/run-store'
import { logError, logEvent } from '@/lib/observability'
import { capture } from '@/lib/posthog'

import { agent } from './router'
import { signalAgentRunCancellation } from './run-cancel'
import { agentRunKey, agentRuns } from './run-registry'
import { traceAgentChatEvent } from './trace'

import type { AgentRunTrace } from './types'

agent.post('/chat/:streamId/abort', async (c) => {
  const userId = c.get('userId')
  const requestId = c.get('requestId') ?? randomUUID()
  const streamId = c.req.param('streamId')
  const abortSpan = startTraceSpan({
    name: 'agent.chat.abort_request',
    type: 'function',
    metadata: {
      route: '/agent/chat/:streamId/abort',
      method: 'POST',
      requestId,
      userId,
      streamId,
    },
  })
  const trace: AgentRunTrace = {
    requestId,
    userId,
    sessionId: 'unknown',
    streamId,
    route: '/agent/chat/:streamId/abort',
    method: 'POST',
    chatSpan: abortSpan,
  }
  const run = agentRuns.get(agentRunKey(userId, streamId))

  traceAgentChatEvent(
    run && !run.done ? 'warn' : 'info',
    'agent.chat.abort_request.received',
    trace,
    {
      run_found: Boolean(run),
      run_done: run?.done,
      run_session_id: run?.sessionId,
      frame_count: run?.frames.length,
      last_finish_reason: run?.lastFinishReason,
    },
  )
  if (run && !run.done) {
    traceAgentChatEvent('warn', 'agent.chat.abort_request.aborting_run', run.trace, {
      abort_request_id: requestId,
      frame_count: run.frames.length,
      last_finish_reason: run.lastFinishReason,
      run_age_ms: Date.now() - run.createdAt,
    })
    signalAgentRunCancellation(run)
    // Cancellation is a request, not a terminal state. Keep the run, its SSE
    // stream, and its distributed ownership alive until the OpenAB prompt
    // resolves. The runtime is the authority on when the turn actually stops;
    // finishing here used to make Nuphos report an idle conversation while the
    // runtime was still executing the same turn.
    abortSpan.end()

    return c.json({ ok: true, status: 'local' })
  }
  const forwarded = await requestAgentRunCancellation(userId, streamId)

  traceAgentChatEvent('info', 'agent.chat.abort_request.forwarded', trace, {
    forwarded,
  })
  abortSpan.end()

  return c.json(
    { ok: forwarded, status: forwarded ? 'forwarded' : 'not_found' },
    forwarded ? 200 : 404,
  )
})

// The customer-facing terminal failure (auto-resume exhausted, empty response,
// etc.) is detected on the CLIENT — the backend pump only ever saw recoverable
// pauses, so without this beacon the actual give-up was invisible server-side
// (not in stdout, OTel, or Braintrust). The client posts the full cause chain
// here on give-up; we record it as an error-level child span so the worst
// outcome is queryable everywhere alongside the per-pause breadcrumbs.
agent.post('/chat/:streamId/report-failure', async (c) => {
  const userId = c.get('userId')
  const requestId = c.get('requestId') ?? randomUUID()
  const streamId = c.req.param('streamId')
  let body: Record<string, unknown> = {}

  try {
    const parsed = await c.req.json()

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>
    }
  } catch {
    // Body is best-effort; an unparseable beacon still records the failure.
  }
  const run = agentRuns.get(agentRunKey(userId, streamId))
  const sessionId =
    (typeof body.sessionId === 'string' && body.sessionId) || run?.sessionId || 'unknown'
  const phase = typeof body.phase === 'string' ? body.phase : 'client_failure'
  // The client also beacons non-terminal breadcrumbs here (a dispatch that
  // produced no request, a first-byte timeout, a reconnect). Those are not
  // failures — recording them as exceptions would drown the real ones — but
  // they must still reach Tempo, because a client-side stall is invisible to
  // every server-side signal by definition.
  const level = body.level === 'info' || body.level === 'warn' ? body.level : 'error'
  const message =
    typeof body.message === 'string' && body.message
      ? body.message
      : `Agent turn failed on the client (${phase}).`
  // A real Error so the stack/exception path lights up in OTel + Braintrust.
  const failure = new Error(message)

  failure.name = 'AgentClientFailure'
  // The client's own breadcrumb fields go in first so the server-derived
  // attribution below always wins: `body` is authenticated but still
  // client-controlled, and a payload naming its own `streamId` must not be able
  // to rewrite which stream the log line belongs to.
  const extras = {
    ...(body.detail && typeof body.detail === 'object' && !Array.isArray(body.detail)
      ? (body.detail as Record<string, unknown>)
      : {}),
    requestId,
    userId,
    streamId,
    session_id: sessionId,
    client_phase: phase,
    client_level: level,
    paused_reason: body.pausedReason ?? null,
    auto_resume_attempts: body.autoResumeAttempts ?? null,
    turn_continuations: body.turnContinuations ?? null,
    // The structured stall chain the client lifted from the atlas-turn-paused frame.
    stall_detail: body.detail ?? null,
  }

  capture('agent_lifecycle', {
    distinctId: userId,
    properties: {
      phase: `client.${phase}`,
      source: 'client',
      stream_id: streamId,
      session_id: sessionId,
      level,
      message,
    },
  })
  if (level !== 'error') {
    logEvent(level, 'agent.chat.client_breadcrumb', extras)
    const span = startTraceSpan({
      name: `agent.chat.client.${phase}`,
      metadata: {
        route: '/agent/chat/:streamId/report-failure',
        method: 'POST',
        phase: `agent.chat.client.${phase}`,
        ...extras,
      },
      input: { message },
    })

    span.end()

    return c.json({ ok: true })
  }
  // stdout (always) + a dedicated, top-level Braintrust/OTel span with the error
  // attached, so this terminal failure is independently queryable by name in
  // every surface — not annotated onto a shared span where it'd be overwritten.
  logError('agent.chat.client_failure', failure, extras)
  const failureSpan = startTraceSpan({
    name: 'agent.chat.client_failure',
    type: 'task',
    metadata: {
      route: '/agent/chat/:streamId/report-failure',
      method: 'POST',
      phase: 'agent.chat.client_failure',
      ...extras,
    },
    input: { message },
  })

  logSpanError(failureSpan, failure)
  failureSpan.end()

  return c.json({ ok: true })
})
