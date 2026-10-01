// Run-side state for one Claude Code preview turn: the run frames go to, the
// tool steps seen so far, and the stream handoff when a blocking decision
// parks the turn (the desktop needs the SSE stream to END, then re-attaches
// on a new streamId once it has decided).
import { randomUUID } from 'node:crypto'

import { bindPreviewRunFrameBridge } from '@/lib/claude-code-preview/run-frame-bridge'

import {
  appendAgentRunDone,
  appendAgentRunFrame,
  appendAgentRunPhase,
  appendAgentRunTurnComplete,
  finishAgentRun,
} from './run-frames'
import { createAgentRun, registerAgentRun } from './run-registry'

import type { AgentRun } from './types'
import type { PreviewDecision, PreviewWait } from '@/lib/claude-code-preview/decision-waiter'
import type { PreviewToolStep } from '@/lib/claude-code-preview/preview-transcript'
import type { PreviewFrameConsumer } from '@/lib/claude-code-preview/run-frame-bridge'

export type PreviewRunState = {
  current: () => AgentRun
  /** Aborts when whichever run currently owns the stream is aborted. */
  signal: AbortSignal
  /** Whether the stream was handed off at least once (the original run is finished). */
  handedOff: () => boolean
  emit: (frame: Record<string, unknown>) => void
  onPause: (wait: PreviewWait) => void
  /** Moves the turn onto the decider's stream; true when a new run took over. */
  onResume: (decision: PreviewDecision) => boolean
  consumeFrames: (consumer: PreviewFrameConsumer) => void
  /** Closes the current run normally (turn-complete, done, finish). */
  finish: () => void
  /** Drops the frame-bridge subscription without closing the run. */
  unbind: () => void
}

export function createPreviewRunState(args: {
  run: AgentRun
  userId: string
  sessionId: string
}): PreviewRunState {
  let current = args.run
  let handedOff = false
  let frameConsumer: PreviewFrameConsumer | undefined
  const bindCurrent = () =>
    bindPreviewRunFrameBridge(current, args.userId, args.sessionId, (frame) => {
      return frameConsumer ? frameConsumer(frame) : false
    })
  let unbind = bindCurrent()
  const turnAbort = new AbortController()
  const follow = (run: AgentRun) => {
    run.abortController.signal.addEventListener(
      'abort',
      () => {
        turnAbort.abort(run.abortController.signal.reason)
      },
      { once: true },
    )
  }

  follow(current)

  const emit = (frame: Record<string, unknown>) => {
    appendAgentRunFrame(current, `data: ${JSON.stringify({ ...frame, emittedAt: Date.now() })}\n\n`)
  }
  const close = () => {
    appendAgentRunTurnComplete(current)
    appendAgentRunDone(current)
    finishAgentRun(current)
  }

  return {
    current: () => current,
    signal: turnAbort.signal,
    handedOff: () => handedOff,
    emit,
    consumeFrames: (consumer) => {
      frameConsumer = consumer
    },
    onPause: (wait) => {
      if (current.done) return
      // The desktop reads the parked card from the last assistant message once
      // the stream ends; client tools additionally report the classic finish.
      current.lastFinishReason = wait.kind === 'client-tool' ? 'tool-calls' : 'stop'
      current.awaitingDecision = wait.kind
      unbind()
      close()
    },
    onResume: (decision) => {
      if (!current.done) {
        if (!decision.streamId) return false
        current.lastFinishReason = 'stop'
        unbind()
        close()
      }
      const next = createAgentRun(
        args.userId,
        args.sessionId,
        decision.streamId ?? randomUUID(),
        current.trace,
      )

      registerAgentRun(next)
      follow(next)
      current = next
      handedOff = true
      unbind = bindCurrent()
      appendAgentRunPhase(next, 'thinking')

      return true
    },
    finish: () => {
      if (current.done) return
      current.lastFinishReason = 'stop'
      unbind()
      close()
    },
    unbind: () => {
      unbind()
    },
  }
}

type ToolState = { name: string; toolName: string; input: unknown; hidden: boolean }

/**
 * Tool steps for the durable transcript, keyed by ACP tool-call id. Nuphos
 * tools invoked through the `nuphos-tools` MCP are recorded under their
 * classic name so reloaded conversations re-render the same cards.
 */
export function createPreviewToolLog() {
  const states = new Map<string, ToolState>()
  const steps = new Map<string, PreviewToolStep>()

  return {
    states,
    record(toolCallId: string, toolName: string, input: unknown) {
      const existing = steps.get(toolCallId)

      steps.set(toolCallId, {
        ...existing,
        toolCallId,
        toolName,
        input,
        startedAt: existing?.startedAt ?? Date.now(),
      })
    },
    complete(toolCallId: string, output: unknown) {
      const step = steps.get(toolCallId)

      if (step) steps.set(toolCallId, { ...step, output, completedAt: Date.now() })
    },
    /** The first failure is the cause; later reports (the agent's echo of a denial) don't replace it. */
    fail(toolCallId: string, errorText: string): string {
      const step = steps.get(toolCallId)

      if (step?.errorText !== undefined) return step.errorText
      if (step) steps.set(toolCallId, { ...step, errorText, completedAt: Date.now() })

      return errorText
    },
    list: (): PreviewToolStep[] => [...steps.values()],
  }
}
