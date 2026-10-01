import { useCallback } from 'react'

import { reportFrontendError } from '../../../lib/frontendErrorReporter'

import { registerTextDrainCompletion } from './streamBuffer'
import { foldTextDeltaIntoTab, takeStreamChunk, streamDelayFor } from './streamText'

import type { PanelCtx } from './ctx'

type Acc = Pick<
  PanelCtx,
  'queueTranscriptSync' | 'setTabs' | 'tabsRef' | 'teamIdRef' | 'textBuffersRef'
>

export function useTextStreaming(acc: Acc) {
  const { queueTranscriptSync, setTabs, tabsRef, teamIdRef, textBuffersRef } = acc

  const appendTextToStream = useCallback(
    (streamId: string, delta: string) => {
      setTabs((prev) => {
        let changed = false
        const next = prev.map((t) => {
          if (t.streamId !== streamId) return t
          const nextTab = foldTextDeltaIntoTab(t, delta)

          if (nextTab === t) return t
          changed = true
          queueTranscriptSync(nextTab, 1500)

          return nextTab
        })

        return changed ? next : prev
      })
    },
    [queueTranscriptSync],
  )

  const drainTextBuffer = useCallback(
    (streamId: string) => {
      // Local, so the self-scheduling tick can name itself without reaching
      // back through the memoized callback it lives in.
      const drain = (id: string) => {
        const entry = textBuffersRef.current.get(id)

        if (!entry) return
        const streamStillActive = tabsRef.current.some((t) => t.streamId === id)

        if (!streamStillActive) {
          if (entry.timer !== null) window.clearTimeout(entry.timer)
          textBuffersRef.current.delete(id)
          entry.onDrained?.()

          return
        }
        entry.timer = null
        if (!entry.text) {
          textBuffersRef.current.delete(id)

          return
        }

        const { chunk, rest } = takeStreamChunk(entry.text)

        entry.text = rest
        appendTextToStream(id, chunk)

        if (entry.text) {
          entry.timer = window.setTimeout(() => drain(id), streamDelayFor(entry.text.length))
        } else {
          textBuffersRef.current.delete(id)
          entry.onDrained?.()
        }
      }

      drain(streamId)
    },
    [appendTextToStream],
  )

  const enqueueTextDelta = useCallback(
    (streamId: string, delta: string) => {
      if (!delta) return
      const existing = textBuffersRef.current.get(streamId)

      if (existing) {
        existing.text += delta
        if (existing.timer === null) {
          existing.timer = window.setTimeout(
            () => drainTextBuffer(streamId),
            streamDelayFor(existing.text.length),
          )
        }

        return
      }
      const entry = {
        text: delta,
        timer: window.setTimeout(() => drainTextBuffer(streamId), streamDelayFor(delta.length)),
      }

      textBuffersRef.current.set(streamId, entry)
    },
    [drainTextBuffer],
  )

  const flushTextBuffer = useCallback(
    (streamId: string) => {
      const entry = textBuffersRef.current.get(streamId)

      if (!entry) return
      if (entry.timer !== null) window.clearTimeout(entry.timer)
      textBuffersRef.current.delete(streamId)
      if (entry.text) appendTextToStream(streamId, entry.text)
      entry.onDrained?.()
    },
    [appendTextToStream],
  )

  const deferEndUntilTextDrained = useCallback(
    (streamId: string, onDrained: () => void): boolean => {
      const entry = textBuffersRef.current.get(streamId)

      if (!entry || !registerTextDrainCompletion(entry, onDrained)) return false
      // Completed runs can replay every SSE frame in one event-loop turn. Keep
      // the terminal event parked behind the existing typewriter drain so its
      // final frame cannot collapse a buffered response into one giant append.
      if (entry.timer === null) {
        entry.timer ??= window.setTimeout(
          () => drainTextBuffer(streamId),
          streamDelayFor(entry.text.length),
        )
      }

      return true
    },
    [drainTextBuffer],
  )

  // Every path that leaves the agent stopped ends here, so a backgrounded user
  // always learns WHY from the notification alone. The main process drops it
  // when a window has focus — the transcript is right there in that case.
  const fireStopNotification = useCallback(
    (notification: { title: string; body: string }, sessionId: string) => {
      void window.api
        .agentNotifyStopped({ ...notification, sessionId, teamId: teamIdRef.current })
        .catch((cause: unknown) => {
          reportFrontendError(
            {
              source: 'agent_notification',
              phase: 'stop_notification_failed',
              message: 'Could not deliver the Agent stopped notification.',
              sessionId,
            },
            cause,
          )
        })
    },
    [],
  )

  return {
    appendTextToStream,
    drainTextBuffer,
    enqueueTextDelta,
    flushTextBuffer,
    deferEndUntilTextDrained,
    fireStopNotification,
  }
}
