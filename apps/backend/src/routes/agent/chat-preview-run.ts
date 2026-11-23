// Run-side state for one Claude Code preview turn: the run frames go to, the
// tool steps seen so far, and the stream handoff when a blocking decision
// parks the turn (the desktop needs the SSE stream to END, then re-attaches
// on a new streamId once it has decided).
import { randomUUID } from 'node:crypto'

import { unstoreRequeuedMessages } from '@/lib/agent/db'
import { usageResetsAtOf } from '@/lib/agent/reply-failed'
import { requeueTurnQueue } from '@/lib/agent/session-released'
import { bindPreviewRunFrameBridge } from '@/lib/claude-code-preview/run-frame-bridge'
import { outOfUsageUntilReset } from '@/lib/claude-code-preview/runtime-refusal'

import {
  appendAgentRunDone,
  appendAgentRunFrame,
  appendAgentRunPhase,
  appendAgentRunTurnComplete,
  finishAgentRun,
} from './run-frames'
import { createAgentRun, registerAgentRun } from './run-registry'

import type { AgentChatBody, AgentRun } from './types'
import type { AgentSessionOrigin } from '@/lib/agent/message-origin'
import type { PendingUserMessage } from '@/lib/agent/pending-messages'
import type { PreviewDecision, PreviewWait } from '@/lib/claude-code-preview/decision-waiter'
import type { TurnUsageReport } from '@/lib/claude-code-preview/preview-agent-update'
import type { PreviewFrameConsumer } from '@/lib/claude-code-preview/run-frame-bridge'
import type { TeamRuntimeEndpoint } from '@/lib/claude-code-preview/team-openab-runtime'
import type { UIMessage } from 'ai'

export type PreviewChatTurnArgs = {
  run: AgentRun
  sessionId: string
  teamId: string
  userId: string
  actorUserId?: string
  origin: AgentSessionOrigin
  /** The actor sent this turn's message themselves, so their Personal Credentials apply. */
  humanTurn?: boolean
  /** The open question this turn's message answers. */
  decisionReplyTo?: string
  messages: UIMessage[]
  firstMessage: string
  locale: string
  endpoint: TeamRuntimeEndpoint
  kubeContext?: string
  /** The client driving this turn can run port forwards and other client-side local tools. */
  localToolsEnabled?: boolean
  /** The client driving this turn draws the secure input card. */
  secretCardEnabled?: boolean
  /** Set when the client is resuming a turn rather than sending a new message. */
  resume?: { reason?: NonNullable<AgentChatBody['resumeReason']> }
  diagramId?: string
  currentUrl?: string | null
  slackThread?: { teamId: string; channelId: string; threadTs: string }
  /** Answers in a Slack, Lark or Discord thread, so it also takes their queued messages. */
  channelTurn?: boolean
  /** Background shown to the model beside this turn's message, never stored in it. */
  turnContext?: string
  /** A headless caller that puts its own messages back on the queue when the runtime refuses. */
  clientResendsRefusal?: boolean
  /** A headless caller that puts its messages back while its agent is out of usage. */
  waitsOutUsage?: boolean
  /** The message this turn runs: a refusal puts it at the head of the session queue. */
  queued?: PendingUserMessage
  /** `queued` was sent just now and never waited there, so a Stop is aimed at it. */
  direct?: boolean
  onRunHandoff?: (next: AgentRun) => void
  /** The usage the runtime reported for this turn, for per-turn accounting. */
  onTurnUsage?: (report: TurnUsageReport) => void
}

/**
 * The agent never received this turn's messages: the runtime refused them, or
 * the turn was stopped before its prompt went out. What the turn took from the
 * queue waits there again instead of being recorded as read. True when the
 * message that started the turn went back too, leaving nothing to record.
 *
 * A stopped direct send does not go back: it would run once the queue retried.
 * A message that waited in the queue does, as the Stop may have been pressed
 * for the turn ahead of it. Refused for usage, it says so until its next try.
 */
export async function requeueUnsent(
  turn: Pick<
    PreviewChatTurnArgs,
    'userId' | 'teamId' | 'sessionId' | 'queued' | 'direct' | 'endpoint'
  >,
  carried: PendingUserMessage[],
  steered: UIMessage[],
  stopped = false,
  error?: unknown,
): Promise<boolean> {
  const queued = stopped && turn.direct ? undefined : turn.queued
  const { teamId, userId, endpoint } = turn
  const usage = outOfUsageUntilReset(error) && {
    until: await usageResetsAtOf({ teamId, userId, runtimeId: endpoint.runtimeId }).catch(
      () => undefined,
    ),
  }

  await requeueTurnQueue(turn.userId, turn.sessionId, carried, queued, usage)
  steered.length = 0
  // A copy left behind still runs on the retry (turn-history), so a failed removal only shows it.
  await unstoreRequeuedMessages({
    sessionId: turn.sessionId,
    ownerUserId: turn.userId,
    teamId,
    messageIds: [...(queued ? [queued.id] : []), ...carried.map((entry) => entry.id)],
  }).catch(() => undefined)

  return Boolean(queued)
}

/** Set when the runtime connection dropped mid-turn and the turn was left to it. */
export type TurnEnd = 'connection-lost' | undefined

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
    const { signal } = run.abortController

    // A Stop that came while the turn was being saved has already fired its event.
    if (signal.aborted) turnAbort.abort(signal.reason)
    else signal.addEventListener('abort', () => turnAbort.abort(signal.reason), { once: true })
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

export { createPreviewToolLog } from './chat-preview-tool-log'
