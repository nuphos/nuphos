import { streamAgentRunFromRedis } from '@/lib/agent/run-store'
import { startTraceSpan } from '@/lib/agent/tracing'
import { AppError } from '@/lib/errors'

import { agentRuns } from './run-registry'
import { streamAgentRunResponse } from './run-stream'
import { traceAgentChatError, traceAgentChatEvent } from './trace'

import type { AgentRun, ResumeParams } from './types'

/**
 * Handle a /chat request whose (user, streamId) already has a local run.
 * Returns the SSE response to attach to, or null when the completed run was
 * discarded and the caller should start a fresh turn.
 */
export function handleExistingRun(existingRun: AgentRun, params: ResumeParams): Response | null {
  const { requestId, userId, runOwnerUserId, sessionId: id, teamId, streamId, body } = params

  if (existingRun.sessionId !== id) {
    const conflictSpan = startTraceSpan({
      name: 'agent.chat.preflight_error',
      type: 'function',
      metadata: {
        route: '/agent/chat',
        method: 'POST',
        requestId,
        userId: runOwnerUserId,
        viewerUserId: userId,
        sessionId: id,
        teamId,
        streamId,
        existingSessionId: existingRun.sessionId,
        errorCode: 'stream_conflict',
      },
    })

    traceAgentChatEvent(
      'error',
      'agent.chat.preflight.stream_conflict',
      {
        requestId,
        userId,
        sessionId: id,
        teamId,
        streamId,
        route: '/agent/chat',
        method: 'POST',
        chatSpan: conflictSpan,
      },
      {
        existing_session_id: existingRun.sessionId,
        existing_run_done: existingRun.done,
        existing_run_frame_count: existingRun.frames.length,
      },
    )
    conflictSpan.end()
    throw new AppError(409, 'stream_conflict', 'Stream id belongs to another conversation')
  }
  // Caller asked for a fresh start (e.g. client-side retry after a failed
  // stream). If the same stream is still active, treat this as a defensive
  // attach instead of aborting the run; client reconnect bugs must not kill
  // ongoing tool/model work. Completed runs can still be discarded below.
  if (body.resume === false) {
    if (params.readOnlyResume) {
      throw new AppError(403, 'conversation_read_only', 'You can only view this team conversation')
    }
    if (!existingRun.done) {
      const requestedResumeFrom = body.resumeFrom
      const coercedResumeFrom =
        typeof requestedResumeFrom === 'number' &&
        Number.isFinite(requestedResumeFrom) &&
        requestedResumeFrom > 0
          ? requestedResumeFrom
          : existingRun.frames.length
      const localResumeSpan = startTraceSpan({
        name: 'agent.chat.resume.local',
        type: 'function',
        metadata: {
          route: '/agent/chat',
          method: 'POST',
          requestId,
          userId: runOwnerUserId,
          viewerUserId: userId,
          sessionId: id,
          teamId,
          streamId,
          resumeFrom: coercedResumeFrom,
          requestedResumeFrom,
          existingRunDone: existingRun.done,
          existingRunFrameCount: existingRun.frames.length,
          coercedFreshStart: true,
        },
      })

      traceAgentChatEvent(
        'warn',
        'agent.chat.preflight.fresh_start_coerced_to_resume',
        {
          requestId,
          userId: runOwnerUserId,
          sessionId: id,
          teamId,
          streamId,
          route: '/agent/chat',
          method: 'POST',
          chatSpan: localResumeSpan,
        },
        {
          viewer_user_id: userId,
          read_only_resume: params.readOnlyResume,
          fresh_request_id: requestId,
          fresh_session_id: id,
          fresh_team_id: teamId,
          requested_resume_from: requestedResumeFrom,
          coerced_resume_from: coercedResumeFrom,
          existing_run_frame_count: existingRun.frames.length,
          existing_run_age_ms: Date.now() - existingRun.createdAt,
          last_finish_reason: existingRun.lastFinishReason,
        },
      )
      localResumeSpan.end()

      return streamAgentRunResponse(existingRun, coercedResumeFrom)
    }
    agentRuns.delete(existingRun.key)

    return null
  }
  const localResumeSpan = startTraceSpan({
    name: 'agent.chat.resume.local',
    type: 'function',
    metadata: {
      route: '/agent/chat',
      method: 'POST',
      requestId,
      userId: runOwnerUserId,
      viewerUserId: userId,
      sessionId: id,
      teamId,
      streamId,
      resumeFrom: body.resumeFrom,
      existingRunDone: existingRun.done,
      existingRunFrameCount: existingRun.frames.length,
    },
  })

  traceAgentChatEvent(
    'info',
    'agent.chat.resume.local_run_found',
    {
      requestId,
      userId: runOwnerUserId,
      sessionId: id,
      teamId,
      streamId,
      route: '/agent/chat',
      method: 'POST',
      chatSpan: localResumeSpan,
    },
    {
      viewer_user_id: userId,
      read_only_resume: params.readOnlyResume,
      resume_from: body.resumeFrom,
      existing_run_done: existingRun.done,
      existing_run_frame_count: existingRun.frames.length,
      existing_run_age_ms: Date.now() - existingRun.createdAt,
      last_finish_reason: existingRun.lastFinishReason,
    },
  )
  localResumeSpan.end()

  return streamAgentRunResponse(existingRun, body.resumeFrom)
}

/** Redis-backed resume for a run owned by (or completed on) another replica. */
export async function resumeFromRedisOrThrow(params: ResumeParams): Promise<Response> {
  const { requestId, userId, runOwnerUserId, sessionId: id, teamId, streamId, body } = params
  const resumeSpan = startTraceSpan({
    name: 'agent.chat.resume.redis',
    type: 'function',
    metadata: {
      route: '/agent/chat',
      method: 'POST',
      requestId,
      userId,
      sessionId: id,
      teamId,
      streamId,
      resumeFrom: body.resumeFrom,
    },
  })
  const resumeTrace = {
    requestId,
    userId: runOwnerUserId,
    sessionId: id,
    teamId,
    streamId,
    span: resumeSpan,
    endSpanOnClose: true,
  }

  traceAgentChatEvent(
    'info',
    'agent.chat.resume.redis_attempt',
    {
      requestId,
      userId: runOwnerUserId,
      sessionId: id,
      teamId,
      streamId,
      route: '/agent/chat',
      method: 'POST',
      chatSpan: resumeSpan,
    },
    {
      viewer_user_id: userId,
      read_only_resume: params.readOnlyResume,
      resume_from: body.resumeFrom,
    },
  )
  // The run might be live on (or recently completed by) another replica.
  // Tail its Redis Stream so the client gets the same SSE stream it would
  // get from the owner. The Redis stream helper opens SSE before waiting, so
  // a transient Redis probe miss cannot turn into a user-visible HTTP 409.
  const remote = await streamAgentRunFromRedis(
    runOwnerUserId,
    streamId,
    body.resumeFrom,
    resumeTrace,
  )

  if (remote) return remote
  const err = new AppError(409, 'stream_not_resumable', 'The agent stream is no longer resumable', {
    reason: 'local run was not found and Redis resume could not attach to a recorded stream',
    streamId,
    sessionId: id,
    teamId,
    resumeFrom: body.resumeFrom,
    redisTraceEvents: [
      'agent.run.redis_resume.redis_disabled',
      'agent.run.redis_resume.probe_failed',
      'agent.run.redis_resume.stream_missing',
      'agent.run.redis_resume.stream_closed',
      'agent.run.redis_resume.owner_abandoned',
      'agent.run.redis_tail_xread_failed',
    ],
    requestId,
  })

  traceAgentChatError(
    'agent.chat.resume.redis_not_resumable',
    err,
    {
      requestId,
      userId: runOwnerUserId,
      sessionId: id,
      teamId,
      streamId,
      route: '/agent/chat',
      method: 'POST',
      chatSpan: resumeSpan,
    },
    {
      viewer_user_id: userId,
      read_only_resume: params.readOnlyResume,
      resume_from: body.resumeFrom,
    },
  )
  resumeSpan.end()
  throw err
}
