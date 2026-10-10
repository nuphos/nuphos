import { randomUUID } from 'node:crypto'

import { initializeSessionBypass } from '@/lib/agent/auto-mode/store'
import { getConversationBySessionId } from '@/lib/agent/db'
import { regionLabel } from '@/lib/agent/model-provider'
import { startTraceSpan } from '@/lib/agent/tracing'
import { resolveConversationChatRuntime } from '@/lib/claude-code-preview/agent-chat-runtime'
import { logError, logEvent } from '@/lib/observability'
import { getSlackAgentThreadBySessionId } from '@/lib/slack/agent-bot'

import { ensurePreviewChannelCredentialsSafe } from './chat-preview-credentials'
import { runClaudeCodePreviewChatTurn } from './chat-preview-turn'
import { HEADLESS_TURN_DEADLINE_MS } from './constants'
import {
  appendAgentRunDone,
  appendAgentRunError,
  appendAgentRunPhase,
  finishAgentRun,
} from './run-frames'
import { attachAgentRunFrameSink, createAgentRun, registerAgentRun } from './run-registry'
import { serializeTelemetryMessages } from './telemetry'
import { persistAcceptedConversationTurn } from './transcript'
import { recordTriggerRunFailure } from './trigger-run-observability'
import { restoreArchivedForTurn } from './turn-unarchive'

import type { AgentRunOutcome } from './run-pump-helpers'
import type { AgentRunFrameSink } from './run-registry'
import type { AgentRun, AgentRunTrace } from './types'
import type { ConversationTriggerRun } from '@/lib/agent/conversation-trigger-run'
import type { AgentClientMeta, AgentCredentialAccess } from '@/lib/agent/db'
import type { LarkReplyToolContext, SlackReplyToolContext } from '@/lib/agent/tools-skilled/types'
import type { AgentSessionOrigin } from '@/lib/agent/tools-triggers-shared'
import type { SlackTriggerNotificationContext } from '@/lib/slack/incident-notifications'
import type { UIMessage } from 'ai'

export type { AgentRunFrameSink } from './run-registry'

export type TriggerRunParams = {
  // Actor for this turn. Tools and credentials always resolve as this user.
  userId: string
  // Durable conversation owner when a shared external thread is continued by
  // another teammate. Defaults to `userId`.
  conversationOwnerUserId?: string
  nuphosToken: string
  teamId: string | undefined
  sessionId: string
  messages: UIMessage[]
  firstMessage: string
  credentialAccess?: AgentCredentialAccess
  source?: string
  /** Trigger-created conversations list under their Trigger; channel bridges remain chats. */
  trigger?: ConversationTriggerRun
  // 'trigger' (Trigger-fired: no trigger tools, Full Access); interactive
  // channels omit it and default to 'user'.
  origin?: AgentSessionOrigin
  client?: AgentClientMeta
  locale?: string
  slackReply?: SlackReplyToolContext
  larkReply?: LarkReplyToolContext
  frameSink?: AgentRunFrameSink
  triggerNotification?: SlackTriggerNotificationContext
}

/**
 * Execute an agent session on behalf of a trigger (cron or webhook).
 * Runs to completion without returning an HTTP stream to the trigger caller,
 * while still creating the same resumable AgentRun used by the interactive UI.
 * Slack sessions can therefore be opened mid-run from Nuphos and observe the
 * accepted user turn plus live model/tool output.
 */
export async function executeAgentForTrigger(params: TriggerRunParams): Promise<AgentRunOutcome> {
  const { userId, teamId, sessionId, messages, firstMessage } = params
  const conversationOwnerUserId = params.conversationOwnerUserId ?? userId
  const source = params.source ?? 'agent.trigger'
  const channelDefaults = source === 'discord.agent' || source === 'slack.agent'
  const fullAccessDefault =
    source !== 'agent.resource' && (channelDefaults || (params.origin ?? 'user') !== 'user')
  const locale = params.locale ?? 'en-US'
  const requestId = randomUUID()
  const streamId = randomUUID()
  const isPotentialNewConversation = messages.length === 1 && messages[0]?.role === 'user'
  const existingConversation = await getConversationBySessionId(sessionId)
  const chatRuntime = await resolveConversationChatRuntime(teamId, existingConversation, { userId })
  const runtimeProvider = chatRuntime.runtime
  const runtimeModelId = chatRuntime.runtime

  await restoreArchivedForTurn(existingConversation, params.origin ?? 'user')

  const chatSpan = startTraceSpan({
    name: 'turn',
    type: 'task',
    metadata: {
      route: source,
      requestId,
      userId,
      conversationOwnerUserId,
      sessionId,
      teamId,
      streamId,
      locale,
      provider: runtimeProvider,
      modelId: runtimeModelId,
      region: regionLabel(),
      isNewConversation: isPotentialNewConversation,
      conversationRootDeferred: true,
      messageCount: messages.length,
    },
    input: {
      messages: serializeTelemetryMessages(messages),
    },
  })

  // The live run belongs to the same durable conversation/session that the
  // desktop observes, even when a teammate is the actor for this turn.
  const runTrace: AgentRunTrace = {
    requestId,
    userId,
    sessionId,
    ...(teamId ? { teamId } : {}),
    streamId,
    route: source,
    method: 'TRIGGER',
    chatSpan,
  }
  const run = createAgentRun(conversationOwnerUserId, sessionId, streamId, runTrace)

  // Every caller of this function is headless — nobody on the other end can
  // press Stop, so the turn needs an outer bound of its own.
  run.deadlineAt = Date.now() + HEADLESS_TURN_DEADLINE_MS
  registerAgentRun(run)
  appendAgentRunPhase(run, 'request-accepted')

  const attachFrameSink = (target: AgentRun) => {
    if (!params.frameSink) return
    attachAgentRunFrameSink(target, params.frameSink, 'agent.trigger.frame_sink.error', {
      request_id: requestId,
      session_id: sessionId,
      stream_id: target.streamId,
      source,
    })
  }

  attachFrameSink(run)

  try {
    if (fullAccessDefault) await initializeSessionBypass(sessionId, userId, true)
    appendAgentRunPhase(run, 'saving-turn')
    const isNewConversationPromise = persistAcceptedConversationTurn({
      sessionId,
      userId: conversationOwnerUserId,
      teamId,
      messages,
      firstMessage,
      locale,
      credentialAccess: conversationOwnerUserId === userId ? params.credentialAccess : undefined,
      source,
      trigger: params.trigger,
      client: params.client,
      agentRuntime: chatRuntime.runtime,
    })
      .then((acceptedTurn) => acceptedTurn?.isNew ?? isPotentialNewConversation)
      .catch((err: unknown) => {
        logError('agent.trigger.accepted_turn_persist.error', err, {
          request_id: requestId,
          user_id: userId,
          session_id: sessionId,
          team_id: teamId,
          stream_id: streamId,
          source,
        })
        throw err
      })

    if (!teamId) throw new Error('An agent conversation is missing its Team scope.')
    const [, , slackThread] = await Promise.all([
      // The accepted-turn write stays authoritative: the preflight below is best-effort,
      // but a failed durable Claude conversation must still prevent the runtime prompt.
      isNewConversationPromise,
      ensurePreviewChannelCredentialsSafe({
        selectAllCredentials: channelDefaults,
        channelOriginated: channelDefaults || Boolean(params.slackReply ?? params.larkReply),
        sessionId,
        teamId,
        actorUserId: userId,
        conversationOwnerUserId,
        acceptedTurn: isNewConversationPromise,
        requestId,
        source,
      }),
      getSlackAgentThreadBySessionId(sessionId).catch(() => null),
    ])

    await runClaudeCodePreviewChatTurn({
      run,
      sessionId,
      teamId,
      userId: conversationOwnerUserId,
      actorUserId: userId,
      origin: params.origin ?? 'user',
      messages,
      firstMessage,
      locale,
      endpoint: chatRuntime.endpoint,
      onRunHandoff: attachFrameSink,
      ...(slackThread
        ? {
            slackThread: {
              teamId: slackThread.slackWorkspaceId,
              channelId: slackThread.slackChannelId,
              threadTs: slackThread.slackThreadTs,
            },
          }
        : {}),
    })
    chatSpan.end()

    return { status: 'completed', finishReason: 'stop' }
  } catch (err) {
    recordTriggerRunFailure(err, runTrace, source)
    chatSpan.end()
    if (!run.abortController.signal.aborted) {
      appendAgentRunError(run, err)
      appendAgentRunDone(run)
    }
    finishAgentRun(run)
    throw err
  }
}
