import { useCallback, useEffect } from 'react'

import { api } from '../../../api'
import { track } from '../../../lib/analytics'
import { toast } from '../../ui/toast'

import { runEndEvent } from './endEvent'

import type { PanelCtx } from './ctx'
import type { MessageRating } from './model'

type Acc = Pick<
  PanelCtx,
  | 'fireStopNotification'
  | 'deferEndUntilTextDrained'
  | 'kubeContextRef'
  | 'pendingEndEffectsRef'
  | 'queueTranscriptSync'
  | 'setTabs'
  | 'streamOwnersRef'
  | 'stoppedRunIdsRef'
  | 'tabsRef'
  | 'teamId'
  | 'teamIdRef'
  | 'textBuffersRef'
  | 'turnCompleteRef'
  | 'turnPausedRef'
  | 'urlRef'
>

export function useEndOfStream(acc: Acc) {
  const {
    fireStopNotification,
    deferEndUntilTextDrained,
    kubeContextRef,
    pendingEndEffectsRef,
    queueTranscriptSync,
    setTabs,
    streamOwnersRef,
    stoppedRunIdsRef,
    tabsRef,
    teamId,
    teamIdRef,
    textBuffersRef,
    turnCompleteRef,
    turnPausedRef,
    urlRef,
  } = acc

  // Handles the trailing `end` event the main process emits after every
  // stream. Decides between four outcomes:
  //   1. Saw atlas-turn-complete → normal end, finalize the turn.
  //   2. No turn-complete, pending client-side local tool calls → execute
  //      them in Electron, append tool outputs, then submit the next request.
  //   3. Saw atlas-turn-paused → the backend says it stopped the turn. The turn
  //      is over: surface the reason it gave. No silent re-issue.
  //   4. No terminal frame at all → the transport dropped mid-turn; resume the
  //      same messages with a fresh streamId while MAX_AUTO_RESUME_ATTEMPTS
  //      lasts (it refills whenever a stream delivers renderable output), then
  //      surface an error the user can retry from.
  // Errors that latched mid-stream (`evType === 'error'` or SSE error frame)
  // skip auto-resume entirely — those have already populated tab.error.
  //
  // All decisions are made inside a single setTabs updater that first folds
  // any pending text-buffer chunk into `prev`. Reading tabsRef.current after
  // a `flushTextBuffer` would see pre-flush state because React batches the
  // setTabs call, which would forward a truncated transcript to the backend
  // on resume.
  // Thumbs feedback on an assistant message: optimistic tab-state update plus
  // a fire-and-forget persist. `rating: null` clears a previous vote. The
  // optional comment arrives on a second call from the thumbs-down dialog.
  const handleMessageFeedback = useCallback(
    (sessionId: string, messageId: string, rating: MessageRating | null, comment?: string) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.sessionId === sessionId
            ? {
                ...t,
                messages: t.messages.map((m) =>
                  m.id === messageId ? { ...m, feedback: rating ?? undefined } : m,
                ),
              }
            : t,
        ),
      )
      // The comment submit re-sends the same vote with detail attached — only
      // the vote click counts as a feedback event, so commented votes aren't
      // double-tracked.
      if (comment === undefined) {
        track('agent_message_feedback', { rating: rating ?? 'cleared' })
      }
      api
        .agentSendMessageFeedback({
          sessionId,
          messageId,
          rating,
          ...(comment ? { comment } : {}),
          ...(teamId ? { teamId } : {}),
        })
        .catch((err: unknown) => {
          toast.apiError('Could not save feedback', err)
        })
    },
    [setTabs, teamId],
  )
  const handleEndEvent = useCallback(
    (streamId: string) =>
      runEndEvent(
        {
          setTabs,
          tabsRef,
          textBuffersRef,
          turnCompleteRef,
          turnPausedRef,
          streamOwnersRef,
          stoppedRunIdsRef,
          pendingEndEffectsRef,
          teamIdRef,
          urlRef,
          kubeContextRef,
          queueTranscriptSync,
          fireStopNotification,
          deferEndUntilTextDrained,
        },
        streamId,
      ),
    [
      setTabs,
      tabsRef,
      textBuffersRef,
      turnCompleteRef,
      turnPausedRef,
      streamOwnersRef,
      stoppedRunIdsRef,
      pendingEndEffectsRef,
      teamIdRef,
      urlRef,
      kubeContextRef,
      queueTranscriptSync,
      fireStopNotification,
      deferEndUntilTextDrained,
    ],
  )

  // Drains the end-of-stream side effects whose updater ran during a render
  // instead of inside setTabs. No dep array: this must run after every commit,
  // because the commit is what proves the updater has produced its decisions.
  useEffect(() => {
    const queued = pendingEndEffectsRef.current

    if (queued.length === 0) return
    pendingEndEffectsRef.current = []
    for (const apply of queued) apply()
  })

  return { handleMessageFeedback, handleEndEvent }
}
