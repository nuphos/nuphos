import { useEffect } from 'react'

import { handleAgentEvent } from './agentEvents'

import type { PanelCtx } from './ctx'

type Acc = Pick<
  PanelCtx,
  | 'enqueueTextDelta'
  | 'flushTextBuffer'
  | 'handleEndEvent'
  | 'queueTranscriptSync'
  | 'setTabs'
  | 'streamOwnersRef'
  | 'stoppedRunIdsRef'
  | 'syncTimersRef'
  | 'tabsRef'
  | 'textBuffersRef'
  | 'turnCompleteRef'
  | 'turnPausedRef'
>

export function useAgentEventStream(acc: Acc) {
  const {
    enqueueTextDelta,
    flushTextBuffer,
    handleEndEvent,
    queueTranscriptSync,
    setTabs,
    streamOwnersRef,
    stoppedRunIdsRef,
    syncTimersRef,
    tabsRef,
    textBuffersRef,
    turnCompleteRef,
    turnPausedRef,
  } = acc

  // Subscribe to agent events. Route by streamId to the right tab.
  useEffect(() => {
    const off = window.api.onAgentEvent(({ streamId, event }) =>
      handleAgentEvent(
        {
          tabsRef,
          setTabs,
          streamOwnersRef,
          stoppedRunIdsRef,
          turnCompleteRef,
          turnPausedRef,
          textBuffersRef,
          syncTimersRef,
          enqueueTextDelta,
          flushTextBuffer,
          handleEndEvent,
          queueTranscriptSync,
        },
        streamId,
        event,
      ),
    )

    return off
  }, [
    tabsRef,
    setTabs,
    streamOwnersRef,
    stoppedRunIdsRef,
    turnCompleteRef,
    turnPausedRef,
    textBuffersRef,
    syncTimersRef,
    enqueueTextDelta,
    flushTextBuffer,
    handleEndEvent,
    queueTranscriptSync,
  ])

  useEffect(() => {
    return () => {
      for (const entry of textBuffersRef.current.values()) {
        if (entry.timer !== null) window.clearTimeout(entry.timer)
      }
      textBuffersRef.current.clear()
      turnCompleteRef.current.clear()
      turnPausedRef.current.clear()
    }
  }, [])
}
