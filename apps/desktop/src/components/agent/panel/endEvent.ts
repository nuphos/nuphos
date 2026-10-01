import { track } from '../../../lib/analytics'

import { decideEndOfStream, emptyEndDecision } from './endEventDecision'
import { runEndEventEffects } from './endEventEffects'

import type { PanelCtx } from './ctx'

export type EndEventCtx = Pick<
  PanelCtx,
  | 'fireStopNotification'
  | 'deferEndUntilTextDrained'
  | 'kubeContextRef'
  | 'pendingEndEffectsRef'
  | 'queueTranscriptSync'
  | 'setTabs'
  | 'stoppedRunIdsRef'
  | 'streamOwnersRef'
  | 'tabsRef'
  | 'teamIdRef'
  | 'textBuffersRef'
  | 'turnCompleteRef'
  | 'turnPausedRef'
  | 'urlRef'
>

export function runEndEvent(ctx: EndEventCtx, streamId: string) {
  if (ctx.deferEndUntilTextDrained(streamId, () => runEndEvent(ctx, streamId))) return

  const {
    setTabs,
    textBuffersRef,
    turnCompleteRef,
    turnPausedRef,
    streamOwnersRef,
    pendingEndEffectsRef,
    tabsRef,
  } = ctx

  const sawTurnComplete = turnCompleteRef.current.has(streamId)

  turnCompleteRef.current.delete(streamId)
  const sawTurnPaused = turnPausedRef.current.get(streamId)

  turnPausedRef.current.delete(streamId)
  const streamOwner = streamOwnersRef.current.get(streamId)
  const ownerSessionId =
    streamOwner?.sessionId ?? tabsRef.current.find((tab) => tab.streamId === streamId)?.sessionId
  const stopRequested = Boolean(
    ownerSessionId && ctx.stoppedRunIdsRef.current.get(ownerSessionId) === streamId,
  )

  streamOwnersRef.current.delete(streamId)

  // Drain + clear the text buffer ourselves so we can fold its contents
  // into the prev snapshot inside the updater below.
  const pendingEntry = textBuffersRef.current.get(streamId)

  if (pendingEntry?.timer != null) window.clearTimeout(pendingEntry.timer)
  textBuffersRef.current.delete(streamId)
  const pendingText = pendingEntry?.text ?? ''

  // Captured inside the updater, fired after setTabs returns. Under React
  // Strict Mode the updater runs twice in dev; both invocations overwrite
  // this with the same payload (uid() in the second run wins, and that
  // matches the second-run state which is what React actually commits).
  const decision = emptyEndDecision()

  setTabs((prev) =>
    decideEndOfStream(
      ctx,
      { streamId, pendingText, sawTurnComplete, sawTurnPaused, stopRequested, decision },
      prev,
    ),
  )

  // Everything the updater decided, applied once the decision exists. Run
  // straight away when the updater already ran (React's eager path), queued
  // for the post-commit drain when it hasn't — by then the render that ran it
  // has committed, so the closure below reads real values either way.
  let effectsApplied = false
  const applyEndEventEffects = () => {
    if (effectsApplied) return
    effectsApplied = true
    runEndEventEffects(ctx, { streamId, sawTurnComplete, sawTurnPaused, streamOwner, decision })
  }

  if (decision.updaterRan) applyEndEventEffects()
  else {
    // React ran the updater during a later render instead of eagerly, so the
    // decisions do not exist yet. #616 made this survivable; this makes it
    // visible, because a queue that never drains is exactly how a turn hangs
    // with nothing to show for it.
    const queuedAt = Date.now()

    track('agent_end_effects_deferred', { stream_id: streamId })
    pendingEndEffectsRef.current.push(() => {
      track('agent_end_effects_drained', {
        stream_id: streamId,
        queued_ms: Date.now() - queuedAt,
      })
      applyEndEventEffects()
    })
  }
}
