import { api } from '../../../api'
import { buildAgentStopNotification } from '../../../lib/agentStopNotification'
import { track, trackError } from '../../../lib/analytics'

import { buildClosedConversationNotification } from './closedConversationNotification'
import { fromPersistedMessages } from './persistence'
import { reportAgentFailureToBackend } from './stall'

import type { PanelCtx } from './ctx'
import type { EndDecision, ResumePayload } from './endEventDecision'
import type { Tab } from './model'
import type { StallDetail } from './stall'

type EndEffectArgs = {
  streamId: string
  sawTurnComplete: boolean
  sawTurnPaused: { reason: string; detail?: StallDetail } | undefined
  streamOwner: { sessionId: string; title: string } | undefined
  decision: EndDecision
}

function notifyClosedConversationStop(
  ctx: Pick<PanelCtx, 'fireStopNotification' | 'teamIdRef'>,
  streamOwner: { sessionId: string; title: string },
) {
  const { sessionId, title } = streamOwner
  const teamId = ctx.teamIdRef.current

  void buildClosedConversationNotification({
    title,
    fetchMessages: async () => {
      const detail = await api.agentGetConversation(sessionId, teamId, { tail: 4 })

      return fromPersistedMessages(detail.messages)
    },
  }).then((notification) => ctx.fireStopNotification(notification, sessionId))
}

export function runEndEventEffects(
  ctx: Pick<
    PanelCtx,
    'fireStopNotification' | 'queueTranscriptSync' | 'setTabs' | 'tabsRef' | 'teamIdRef'
  >,
  args: EndEffectArgs,
) {
  const { setTabs, tabsRef, fireStopNotification, queueTranscriptSync } = ctx
  const { streamId, sawTurnComplete, sawTurnPaused, streamOwner, decision } = args

  // Which of the four end-of-stream outcomes this turn took. Without it the
  // only observable difference between "resumed and the POST vanished" and
  // "decided not to resume" is the absence of a later event, which is not
  // evidence of anything. Behind the guard with every other side effect —
  // a double-counted outcome would misread as two turns ending.
  track('agent_stream_end_decided', {
    stream_id: streamId,
    outcome: decision.clientToolPayload
      ? 'client_tool_handoff'
      : decision.resumePayload
        ? 'auto_resume'
        : decision.terminalFailureReportPayload
          ? 'terminal_failure'
          : 'clean_end',
    saw_turn_complete: sawTurnComplete,
    saw_turn_paused: sawTurnPaused?.reason ?? null,
    orphaned: decision.orphaned,
    deferred: !decision.updaterRan,
  })

  // Fired once per recovery (outside the updater so Strict Mode's double-run
  // can't double-report). Distinguishes a never-materialized tool call from a
  // user interruption, so we can see how often the watchdog catches it.
  const incompleteResume = decision.incompleteToolResume

  if (incompleteResume) {
    track('agent_tool_call_incomplete', {
      finish_reason: 'tool-calls',
      watchdog_triggered: true,
      tool_span_created: false,
      session_id: incompleteResume.sessionId,
      stream_id: incompleteResume.streamId,
    })
    trackError({
      source: 'agent_stream',
      phase: 'incomplete_tool_call',
      message: 'The model stopped before it finished generating a tool call.',
      sessionId: incompleteResume.sessionId,
      streamId: incompleteResume.streamId,
    })
  }

  // Outside the updater so Strict Mode's double-run can't double-POST the
  // terminal failure (reportAgentFailureToBackend is unthrottled).
  if (decision.terminalFailureReportPayload) {
    reportAgentFailureToBackend(decision.terminalFailureReportPayload)
  }

  // Same reason: one native notification per stop, not one per updater run.
  // The main process still decides whether to show it (it is suppressed while
  // a window has focus).
  const stopped = decision.stopNotification

  if (stopped) fireStopNotification(stopped, stopped.sessionId)
  // The conversation itself must be gone, not merely un-streaming: a user stop
  // also clears streamId, and that end needs no notification at all. Its
  // transcript left memory with the tab, so the persisted one is fetched to
  // say why the agent stopped.
  else if (
    decision.orphaned &&
    streamOwner &&
    !tabsRef.current.some((t) => t.sessionId === streamOwner.sessionId)
  ) {
    notifyClosedConversationStop(ctx, streamOwner)
  }

  if (decision.clientToolPayload) return

  if (decision.resumePayload) {
    const payload: ResumePayload = decision.resumePayload
    const newStreamId = payload.streamId

    // Pairs with the main process's `start_chat_entered`. This event
    // without that one means the IPC hop ate the turn — the shape of the
    // bug that made a 3m40s hang unattributable.
    track('agent_resume_dispatched', {
      stream_id: newStreamId,
      session_id: payload.sessionId,
      previous_stream_id: streamId,
      saw_turn_paused: sawTurnPaused?.reason ?? null,
      message_count: payload.messages.length,
    })
    void window.api
      .agentStart({ ...payload, continueAfterInterruption: true })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)

        trackError(
          {
            source: 'agent_stream',
            phase: 'agent_resume_failed',
            message,
            streamId: newStreamId,
            previousStreamId: streamId,
            sessionId: payload.sessionId,
          },
          err,
        )
        fireStopNotification(
          buildAgentStopNotification({
            outcome: { kind: 'failed', cause: 'The agent could not be resumed.' },
            title: tabsRef.current.find((t) => t.streamId === newStreamId)?.title,
          }),
          payload.sessionId,
        )
        setTabs((prev) =>
          prev.map((t) => {
            if (t.streamId !== newStreamId) return t
            // Persist the just-folded partial transcript too — otherwise a
            // failed resume would only show the partial text locally and the
            // older persisted version would resurface on chat reopen.
            const nextTab: Tab = {
              ...t,
              streaming: false,
              streamId: null,
              phase: null,
              streamStartedAt: null,
              error: message,
            }

            queueTranscriptSync(nextTab, 250)

            return nextTab
          }),
        )
      })
  }
}
