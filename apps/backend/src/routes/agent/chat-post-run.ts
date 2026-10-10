// The detached execution of an accepted /agent/chat turn: persist the user
// turn, run the model, pump its frames into the run, and — for Slack-bound
// conversations — mirror the turn into the bound thread. Split from
// routes-chat-post.ts so the route reads as request orchestration and stays
// within the file-size budget.

import { trackAgentProducer } from '@/lib/agent/producer-drain'

import { runClaudeCodePreviewChatTurn } from './chat-preview-turn'
import { beginSlackBoundTurnDelivery } from './chat-slack-bound'
import {
  appendAgentRunDone,
  appendAgentRunError,
  appendAgentRunPhase,
  finishAgentRun,
} from './run-frames'
import { attachAgentRunFrameSink } from './run-registry'
import { mirrorAppTurnToDiscord } from '@/routes/discord/turn'
import { traceAgentChatError } from './trace'
import { persistAcceptedConversationTurn } from './transcript'
import { restoreArchivedSession } from './turn-unarchive'

import type { SlackMirrorPayload } from './chat-slack-bound'
import type { AgentRunFrameSink } from './run-registry'
import type { AgentChatBody, AgentRun, InternalChatCtx } from './types'
import type { AgentCredentialAccess } from '@/lib/agent/db'
import type { SpanLike } from '@/lib/agent/tracing'
import type { ConversationChatRuntime } from '@/lib/claude-code-preview/agent-chat-runtime'
import type { SlackAgentThread } from '@/lib/slack/agent-bot'
import type { UIMessage } from 'ai'

export type SlackBoundTurn = {
  thread: SlackAgentThread
  runOwnerUserId: string
  userName: string
  /** Null for continuations and duplicate retries — reply mirroring only. */
  mirror: SlackMirrorPayload | null
}

export function launchAcceptedChatTurn(args: {
  run: AgentRun
  chatCtx: InternalChatCtx
  chatSpan: SpanLike
  conversationParent: string | undefined
  body: AgentChatBody
  teamId: string | undefined
  messages: UIMessage[]
  firstMessage: string
  locale: string
  credentialAccess: AgentCredentialAccess | undefined
  credentialAccessRequested: boolean
  /** Session claim held for every Claude Code or Slack-bound turn. */
  releaseClaim: (() => void) | null
  slack: SlackBoundTurn | null
  chatRuntime: ConversationChatRuntime
}): void {
  const { run, chatCtx, chatSpan, body, teamId, messages, slack, chatRuntime } = args
  const sessionId = body.id

  const attachFrameSink = (target: AgentRun, sink: AgentRunFrameSink) => {
    attachAgentRunFrameSink(target, sink, 'agent.chat.frame_sink.error', {
      request_id: chatCtx.requestId,
      session_id: sessionId,
      stream_id: target.streamId,
    })
  }

  void trackAgentProducer(async () => {
    // Set up in parallel with the user-turn persist below; resolved (and the
    // frame sink attached — buffered frames replay) before the model request
    // needs the slackReply context.
    const slackDeliveryPromise = slack
      ? beginSlackBoundTurnDelivery({
          thread: slack.thread,
          userId: slack.runOwnerUserId,
          userName: slack.userName,
          streamId: chatCtx.streamId,
          mirror: slack.mirror,
          attach: (sink) => {
            attachFrameSink(run, sink)
          },
        })
      : Promise.resolve(null)

    let slackDelivery: Awaited<typeof slackDeliveryPromise> = null
    let discordSink: Awaited<ReturnType<typeof mirrorAppTurnToDiscord>> = null
    let pumpError: unknown

    try {
      appendAgentRunPhase(run, 'saving-turn')
      void restoreArchivedSession(sessionId, 'user')
      // The user-turn persist joins the parallel prep group: handleChatRequest
      // awaits it before anything that needs the write to have landed
      // (default-credential persist on a new conversation, telemetry, title
      // generation), overlapping it with memory recall.
      const isNewConversationPromise = persistAcceptedConversationTurn({
        sessionId,
        userId: run.userId,
        teamId,
        messages,
        firstMessage: args.firstMessage,
        locale: args.locale,
        credentialAccess: args.credentialAccess,
        source: 'app',
        agentRuntime: chatRuntime.runtime,
        runtimeId: chatRuntime.runtimeId,
        runtimeLabel: chatRuntime.runtimeLabel,
      })
        .then((acceptedTurn) => acceptedTurn?.isNew ?? false)
        .catch((err: unknown) => {
          traceAgentChatError('agent.chat.accepted_turn_persist.error', err, run.trace, {
            credential_access_requested: args.credentialAccessRequested,
            message_count: messages.length,
          })
          // The runtime cannot run on a process-local guess: the durable
          // conversation runtime binding must exist before ACP is prompted.
          throw err
        })

      if (!teamId) throw new Error('An agent conversation is missing its Team scope.')
      // The sink must be attached before frames flow; the claim release and
      // finalize in `finally` then close the Slack turn.
      slackDelivery = await slackDeliveryPromise
      // A session bound to a Discord thread mirrors what is said in the app.
      discordSink = await mirrorAppTurnToDiscord({
        sessionId,
        teamId,
        ...(body.continueAfterInterruption
          ? {}
          : { message: messages.findLast((message) => message.role === 'user') }),
      }).catch(() => null)
      if (discordSink) attachFrameSink(run, discordSink.frameSink)
      await isNewConversationPromise
      await runClaudeCodePreviewChatTurn({
        run,
        sessionId,
        teamId,
        userId: run.userId,
        actorUserId: chatCtx.userId,
        origin: chatCtx.agentOrigin,
        messages,
        firstMessage: args.firstMessage,
        locale: args.locale,
        endpoint: chatRuntime.endpoint,
        onRunHandoff: (next) => {
          if (slackDelivery) attachFrameSink(next, slackDelivery.frameSink)
          if (discordSink) attachFrameSink(next, discordSink.frameSink)
        },
        localToolsEnabled: chatCtx.localToolsEnabled,
        ...(body.continueAfterInterruption
          ? { resume: { ...(body.resumeReason ? { reason: body.resumeReason } : {}) } }
          : {}),
        ...(chatCtx.kubeContext ? { kubeContext: chatCtx.kubeContext } : {}),
        ...(chatCtx.diagramId ? { diagramId: chatCtx.diagramId } : {}),
        currentUrl: chatCtx.currentUrl,
        ...(slack
          ? {
              slackThread: {
                teamId: slack.thread.slackWorkspaceId,
                channelId: slack.thread.slackChannelId,
                threadTs: slack.thread.slackThreadTs,
              },
            }
          : {}),
      })
      chatSpan.end()
    } catch (err) {
      pumpError = err
      traceAgentChatError('agent.chat.request.error', err, run.trace, {
        provider: chatRuntime.runtime,
        model_id: chatRuntime.runtime,
        aborted: run.abortController.signal.aborted,
        frame_count: run.frames.length,
        last_finish_reason: run.lastFinishReason,
      })
      chatSpan.end()
      if (!run.abortController.signal.aborted) {
        appendAgentRunError(run, err)
        appendAgentRunDone(run)
      }
      finishAgentRun(run)
    } finally {
      // Release BEFORE finalize's serial Slack I/O: the claim exists to stop
      // two RUNS overlapping, and this run is over — holding it through the
      // card/transcript tail would 409 the desktop's machine-speed
      // continuations (client-tool re-POSTs, stall auto-resume).
      args.releaseClaim?.()
      await discordSink?.finish().catch(() => {})
      if (slackDelivery) {
        await slackDelivery
          .finalize({ stopped: run.abortController.signal.aborted, error: pumpError })
          .catch(() => {})
      }
    }
  })
}
