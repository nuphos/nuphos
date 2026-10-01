import { trackError } from '../../../lib/analytics'
import { toast } from '../../ui/toast'

import { applyEvent } from './applyEvent'
import { finalizeIncompleteTools, latchTabError } from './clientTools'
import { dispatchedDraft, parkRefusedTurn } from './queuedAutoSend'
import { normalizeAgentError, uid } from './stall'
import { stampAssistantTurnEnd } from './streamText'
import { updateCurrentAssistantParts } from './turnBoundaries'

import type { PanelCtx } from './ctx'

// Agent events are broadcast to every window; the busy notice must fire once
// per refused send, only in the window that owns the tab — and the setTabs
// updater can run twice in StrictMode dev. Keyed by streamId (one per send).
const busyNoticeShownForStream = new Set<string>()

export function applyStreamEvent(
  ctx: Pick<PanelCtx, 'flushTextBuffer' | 'queueTranscriptSync' | 'setTabs'>,
  streamId: string,
  ev: Record<string, unknown>,
  evType: string | undefined,
) {
  const { setTabs, flushTextBuffer, queueTranscriptSync } = ctx

  flushTextBuffer(streamId)
  setTabs((prev) =>
    prev.map((t) => {
      if (t.streamId !== streamId) return t
      if (evType === 'aborted' && t.runtimeState?.schemaVersion === 2) {
        return { ...t, streaming: false, connected: false, streamId: null }
      }
      if (evType === 'aborted') {
        // Clear streaming/streamId here so the trailing `end` event (which
        // always follows `aborted` from the main process) is a no-op for
        // this tab. That avoids the `end` handler's "stream ended without
        // returning a response" heuristic firing on a user-initiated stop.
        const finalized = finalizeIncompleteTools(t.messages, 'Stopped by user')
        // Mark the trailing assistant message so the UI can show a "Stopped
        // by user" remark below the (possibly partial) response.
        const messages = stampAssistantTurnEnd(
          finalized.map((msg, i) =>
            i === finalized.length - 1 && msg.role === 'assistant'
              ? { ...msg, stoppedByUser: true }
              : msg,
          ),
        )
        const nextTab = {
          ...t,
          streaming: false,
          streamId: null,
          phase: null,
          streamStartedAt: null,
          messages,
          // Clear any error that may have latched from a frame that won the
          // race against the `aborted` event. The backend filter prevents
          // most of these, but the abort signal flips after frames already
          // in the local reader's buffer have been forwarded.
          error: null,
        }

        queueTranscriptSync(nextTab, 250)

        return nextTab
      }
      if (evType === 'conversation-busy') {
        // A Slack-bound conversation whose agent is mid-reply in the thread —
        // the send was refused before it started. Same transport cleanup as
        // other refusal branches, surfaced as a
        // hand-authored notice instead of stream diagnostics. The optimistic
        // message stays visible so the user can resend it; the server never
        // accepted it, so no transcript sync (Slack-bound tabs never sync
        // anyway).
        if (!busyNoticeShownForStream.has(streamId)) {
          busyNoticeShownForStream.add(streamId)
          if (busyNoticeShownForStream.size > 200) busyNoticeShownForStream.clear()
          toast.error(
            'Agent is replying in Slack',
            'The agent is currently replying in the linked Slack thread. Send your message again once that reply finishes.',
          )
        }

        return {
          ...t,
          streaming: false,
          streamId: null,
          streamStartedAt: null,
          phase: null,
          autoResumeAttempts: 0,
          error: null,
          agentSetupRequired: null,
        }
      }
      if (evType === 'runtime-not-ready') {
        // Refused before it started; useQueuedAutoSend sends a parked message again.
        const draft = dispatchedDraft(streamId)
        const nextTab = parkRefusedTurn(t, draft)

        if (!draft && !busyNoticeShownForStream.has(streamId)) {
          busyNoticeShownForStream.add(streamId)
          toast.error("The agent isn't ready yet", 'Try again in a moment.')
        }

        queueTranscriptSync(nextTab, 250)

        return nextTab
      }
      if (evType === 'agent-setup-required') {
        const message =
          typeof ev.message === 'string'
            ? ev.message
            : 'Connect your agent in Settings → Agent, then try again.'
        const nextTab = {
          ...t,
          messages: stampAssistantTurnEnd(finalizeIncompleteTools(t.messages, message)),
          streaming: false,
          streamId: null,
          streamStartedAt: null,
          phase: null,
          autoResumeAttempts: 0,
          error: null,
          agentSetupRequired: {
            message,
            ...(ev.reason === 'reauthentication' ? { reason: 'reauthentication' as const } : {}),
          },
        }

        queueTranscriptSync(nextTab, 250)

        return nextTab
      }
      if (evType === 'error') {
        const err = normalizeAgentError(typeof ev.error === 'string' ? ev.error : 'Error')

        trackError({
          source: 'agent_stream',
          phase: 'ipc_error',
          message: err,
          streamId,
          sessionId: t.sessionId,
        })
        // Reset transport state alongside surfacing the error. Previously
        // `streaming: true` lingered, which left the composer disabled
        // and the "thinking…" indicator running even though the turn had
        // already failed.
        const nextTab = {
          ...t,
          messages: finalizeIncompleteTools(t.messages, err),
          streaming: false,
          streamId: null,
          streamStartedAt: null,
          phase: null,
          autoResumeAttempts: 0,
          agentSetupRequired: null,
          ...latchTabError(t, err),
        }

        queueTranscriptSync(nextTab, 250)

        return nextTab
      }
      if (evType !== 'sse') return t
      const sse = ev.data as Record<string, unknown>

      // Mid-stream errors from streamText arrive as an SSE data event with type 'error'.
      // Surface them and finalize any orphan tool parts so the next turn is valid.
      if (sse.type === 'error') {
        const err = normalizeAgentError(
          typeof sse.errorText === 'string' ? sse.errorText : 'Stream error',
        )

        trackError({
          source: 'agent_stream',
          phase: 'sse_error_frame',
          message: err,
          streamId,
          sessionId: t.sessionId,
        })
        // Same cleanup as the IPC-level error branch above.
        const nextTab = {
          ...t,
          messages: finalizeIncompleteTools(t.messages, err),
          streaming: false,
          streamId: null,
          streamStartedAt: null,
          phase: null,
          autoResumeAttempts: 0,
          ...latchTabError(t, err),
        }

        queueTranscriptSync(nextTab, 250)

        return nextTab
      }
      const msgs = updateCurrentAssistantParts(t.messages, uid, (parts) => applyEvent(parts, sse))
      const partsChanged = msgs !== t.messages

      if (sse.type === 'tool-output-error') {
        trackError({
          source: 'agent_tool',
          phase: 'tool_output_error',
          message: normalizeAgentError(
            typeof sse.errorText === 'string' ? sse.errorText : 'Agent tool failed.',
          ),
          streamId,
          sessionId: t.sessionId,
          toolName: typeof sse.toolName === 'string' ? sse.toolName : undefined,
        })
      }

      const nextTab = {
        ...t,
        connected: true,
        phase: t.phase === 'stopping' ? ('stopping' as const) : null,
        // Real assistant output proves this resume chain is making
        // progress — refill the consecutive no-progress transport budget
        // so a later stall is judged on its own, not as a repeat of a
        // failure that already recovered. The identical-error streak
        // resets on the same evidence.
        ...(partsChanged
          ? { messages: msgs, autoResumeAttempts: 0, lastErrorKey: null, errorStreak: 0 }
          : {}),
      }

      if (partsChanged) queueTranscriptSync(nextTab, 1500)

      return nextTab
    }),
  )
}
