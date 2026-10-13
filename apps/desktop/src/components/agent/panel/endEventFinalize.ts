import { buildAgentStopNotification } from '../../../lib/agentStopNotification'
import { trackError } from '../../../lib/analytics'

import { finalizeIncompleteTools } from './clientTools'
import { describeStallCause, stallContextLine, INTERRUPTED_TOOL_MESSAGE } from './stall'
import { hasRenderableAssistantContent, stampAssistantTurnEnd } from './streamText'

import type { PanelCtx } from './ctx'
import type { EndDecision } from './endEventDecision'
import type { Tab } from './model'
import type { StallDetail } from './stall'

type FinalizeShared = Pick<PanelCtx, 'queueTranscriptSync'> & {
  flushed: Tab[]
  decision: EndDecision
}

export function finalizeExhaustedTurn(
  o: FinalizeShared & {
    tabSnapshot: Tab
    sawTurnPaused: { reason: string; detail?: StallDetail } | undefined
  },
): Tab[] {
  const { flushed, tabSnapshot, sawTurnPaused, decision, queueTranscriptSync } = o

  // Two ways to land here, and they are different failures: the backend
  // named a reason (turn-paused), or the stream just died and every
  // transport resume failed. Say which.
  const pausedDetail = sawTurnPaused?.detail
  const failurePhase = sawTurnPaused ? 'renderer_turn_stopped' : 'renderer_auto_resume_exhausted'
  const cause = sawTurnPaused
    ? describeStallCause(sawTurnPaused.reason, pausedDetail)
    : 'The agent stream ended before the turn completed and could not be resumed.'
  const errorMessage = [
    sawTurnPaused && tabSnapshot.autoResumeAttempts === 0
      ? cause
      : `${cause} (gave up after ${String(tabSnapshot.autoResumeAttempts)} consecutive resume attempt(s).)`,
    `context=phase=${failurePhase} ${stallContextLine(pausedDetail, tabSnapshot.streamId, tabSnapshot.sessionId)} autoResumeAttempts=${String(tabSnapshot.autoResumeAttempts)} sawTurnPaused=${sawTurnPaused ? sawTurnPaused.reason : 'false'}`,
  ].join('\n')

  // The full root cause surfaces in the turn-level error box (`tab.error`
  // below) and in telemetry. The per-tool chip keeps the generic sentinel
  // so finalizeToolPartForDisplay still refines input-streaming calls to
  // INCOMPLETE_TOOL_MESSAGE and isIncompleteToolCallResume can still detect
  // a never-materialized call on a later manual retry.
  // trackError throttles duplicates, so the Strict Mode double-run of
  // this updater cannot double-report.
  trackError({
    source: 'agent_stream',
    phase: failurePhase,
    message: errorMessage,
    streamId: tabSnapshot.streamId ?? 'unknown',
    sessionId: tabSnapshot.sessionId,
    autoResumeAttempts: tabSnapshot.autoResumeAttempts,
    pausedReason: sawTurnPaused?.reason ?? null,
    // Full backend cause chain → PostHog, so the root cause is queryable
    // there too (not just a coarse 'model-silence').
    stallPhase: pausedDetail?.stallPhase ?? null,
    stallNoFrameMs: pausedDetail?.noFrameMs ?? null,
    stallTimeoutMs: pausedDetail?.stallTimeoutMs ?? null,
    stallLastFrameType: pausedDetail?.lastFrameType ?? null,
    stallToolName: pausedDetail?.toolName ?? null,
  })
  // Beacon the terminal failure to the backend so how the turn ended for
  // the user is recorded server-side too (stdout + OTel + MongoDB).
  // Captured here, fired after setTabs returns (see declaration).
  decision.terminalFailureReportPayload = {
    streamId: tabSnapshot.streamId,
    sessionId: tabSnapshot.sessionId,
    phase: failurePhase,
    message: cause,
    pausedReason: sawTurnPaused?.reason ?? null,
    autoResumeAttempts: tabSnapshot.autoResumeAttempts,
    detail: pausedDetail ?? null,
  }
  decision.stopNotification = {
    ...buildAgentStopNotification({
      outcome: { kind: 'failed', cause },
      title: tabSnapshot.title,
      messages: tabSnapshot.messages,
    }),
    sessionId: tabSnapshot.sessionId,
  }

  return flushed.map((t) => {
    if (t.id !== tabSnapshot.id) return t
    const nextTab: Tab = {
      ...t,
      // Persist the same healed transcript we'd have used for a resume,
      // so a later manual retry doesn't replay an orphan tool call.
      messages: finalizeIncompleteTools(t.messages, INTERRUPTED_TOOL_MESSAGE),
      streaming: false,
      streamId: null,
      phase: null,
      streamStartedAt: null,
      error: errorMessage,
      autoResumeAttempts: 0,
    }

    queueTranscriptSync(nextTab, 250)

    return nextTab
  })
}

export function finalizeCleanEnd(
  o: FinalizeShared & { streamId: string; userStopped?: boolean },
): Tab[] {
  const { flushed, streamId, decision, queueTranscriptSync, userStopped } = o

  // Clean end (turn-complete seen) or already errored: existing finalize.
  // Either way the turn is over — this is where the "why did it stop"
  // notification is composed (a mid-stream error latched into t.error, an
  // approval gate parked in the transcript, or the answer itself).
  return flushed.map((t) => {
    if (t.streamId !== streamId) return t
    if (!userStopped && !t.error && !hasRenderableAssistantContent(t.messages)) {
      const errorMessage = [
        'Agent stream reached end-of-stream without any renderable assistant response.',
        `context=phase=renderer_empty_response streamId=${streamId} sessionId=${t.sessionId}`,
      ].join('\n')

      trackError({
        source: 'agent_stream',
        phase: 'renderer_empty_response',
        message: errorMessage,
        streamId,
        sessionId: t.sessionId,
      })
      const nextTab: Tab = {
        ...t,
        streaming: false,
        streamId: null,
        phase: null,
        streamStartedAt: null,
        error: errorMessage,
        autoResumeAttempts: 0,
      }

      decision.stopNotification = {
        ...buildAgentStopNotification({
          outcome: { kind: 'failed', cause: errorMessage },
          title: t.title,
          messages: t.messages,
        }),
        sessionId: t.sessionId,
      }
      queueTranscriptSync(nextTab, 250)

      return nextTab
    }
    const messages = userStopped
      ? t.messages.map((message, index) =>
          index === t.messages.length - 1 && message.role === 'assistant'
            ? { ...message, stoppedByUser: true }
            : message,
        )
      : t.messages
    const nextTab: Tab = {
      ...t,
      messages: stampAssistantTurnEnd(messages),
      streaming: false,
      streamId: null,
      phase: null,
      streamStartedAt: null,
      autoResumeAttempts: 0,
    }

    if (!userStopped) {
      decision.stopNotification = {
        ...buildAgentStopNotification({
          outcome: t.error ? { kind: 'failed', cause: t.error } : { kind: 'finished' },
          title: t.title,
          messages: nextTab.messages,
        }),
        sessionId: t.sessionId,
      }
    }
    queueTranscriptSync(nextTab, 250)

    return nextTab
  })
}
