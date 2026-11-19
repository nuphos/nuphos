import { randomUUID } from 'node:crypto'

import { claudeNotice, turnFailureCause } from '@/lib/claude-code-preview/openab-acp-errors'
import {
  AGENT_CLI_UNSTARTABLE_MESSAGE,
  userSetupFailure,
} from '@/lib/claude-code-preview/plain-failure'
import { runtimeLabel } from '@/lib/claude-code-preview/runtime-provider'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

import { getConversationBySessionId } from './db'
import { markChannelRead, unmarkChannelRead } from './db/channel-cursor'
import { newestPost } from './channel-newest-post'
import { CHANNEL_SENDER_PREFIX, readChannelMessages } from './db/channels'
import { pushTimelineEvent } from './db/participants'
import { agentConversations } from './db/shared'
import {
  listPendingUserMessages,
  requeuePendingAtHead,
  takePendingUserMessages,
} from './pending-queue'
import { sessionReleased } from './session-released'

import type { AgentConversation } from './db'
import { systemSender } from './message-metadata'

import type { MessageMetadata } from './message-metadata'
import type { ReplyFailedCause } from './db/timeline-events'

/** A channel's wake notice as queued: fixed per channel, so the queue keeps one. */
export const channelNotice = (channelId: string) =>
  `New messages in a Nuphos channel (channelId ${channelId}).`

/** Who a channel's wake notice is from: the channel, never a person. */
export const channelNoticeSender = (
  teamId: string,
  channelId: string,
  displayName: string,
): MessageMetadata =>
  systemSender(
    `${CHANNEL_SENDER_PREFIX}${channelId}`,
    displayName,
    `/teams/${teamId}/agent/${channelId}`,
  )

/**
 * Steers the agent's running turn with the notice and the posts it has not
 * read, through the composer's steer. Only a turn its owner runs takes it, as
 * the composer lets only a turn's actor steer. False when there is no such
 * turn or the runtime cannot take it: the notice then queues.
 */
export async function steerRunningTurn(
  agent: AgentConversation,
  channelId: string,
  metadata: MessageMetadata,
) {
  // Lazy so importing this does not pull in the runtime graph.
  const [{ addRunChannels, getActiveAgentRunForSession }, { steerConversationRuntime }] =
    await Promise.all([
      import('@/lib/agent/run-store'),
      import('@/lib/claude-code-preview/session-execution-state'),
    ])
  const active = await getActiveAgentRunForSession(agent.userId, agent.sessionId)

  if (!active || (active.actorUserId && active.actorUserId !== agent.userId)) return false
  const notice = { source: 'agent.resource', metadata, renderedText: channelNotice(channelId) }
  const { messages, markRead } = await withChannelPosts(agent.sessionId, agent.userId, [notice])

  // Already read, during the very turn it would steer.
  if (!messages[0]) return true
  try {
    await steerConversationRuntime(
      agent,
      { text: messages[0].renderedText, userId: agent.userId, metadata: messages[0].metadata },
      randomUUID(),
    )
  } catch {
    return false
  }
  // The turn now answers this channel too, so the channel shows it typing.
  await addRunChannels(agent.userId, active.streamId, [channelId])
  await markRead()

  return true
}

/** How long a queued notice keeps trying to reach the turn it waits behind. */
export const QUEUED_NOTICE_STEER = { attempts: 15, delayMs: 2_000 }

/**
 * A person's post whose notice queued behind a turn that could not take a
 * steer yet (it was still starting) must not wait for that whole turn to end.
 * Like a waiting message the composer steers, the notice leaves the queue,
 * steers, and goes back to the front if the turn still refuses it. Once no turn
 * runs, the queue starts it as its own turn.
 */
export function steerQueuedNotice(
  agent: AgentConversation,
  channelId: string,
  metadata: MessageMetadata,
  noticeId: string,
) {
  // The notice stays queued, so a failure here only leaves it to the turn's end.
  retrySteer(agent, channelId, metadata, noticeId).catch((error: unknown) => {
    logError('agent.channel.steer_failed', error, {
      channel_id: channelId,
      session_id: agent.sessionId,
    })
  })
}

async function retrySteer(
  agent: AgentConversation,
  channelId: string,
  metadata: MessageMetadata,
  noticeId: string,
) {
  const { userId, sessionId } = agent

  for (let attempt = 0; attempt < QUEUED_NOTICE_STEER.attempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, QUEUED_NOTICE_STEER.delayMs))
    const waiting = (await listPendingUserMessages(userId, sessionId)).find(
      (message) => message.id === noticeId,
    )
    // A turn took it, or another attempt holds it.
    const [notice] = waiting ? await takePendingUserMessages(userId, sessionId, [waiting]) : []

    if (!notice) return
    if (await steerRunningTurn(agent, channelId, metadata)) return
    await requeuePendingAtHead(userId, sessionId, [notice])
    // The turn may have ended while the notice was off the queue.
    sessionReleased(userId, sessionId)
  }
}

/** The channel a message is the wake notice of, if it is one. */
export function channelIdOf(message: { source?: string; metadata?: MessageMetadata }) {
  const id = message.metadata?.sender?.id

  return message.source === 'agent.resource' && id?.startsWith(CHANNEL_SENDER_PREFIX)
    ? id.slice(CHANNEL_SENDER_PREFIX.length)
    : undefined
}

/**
 * Puts what a channel notice is about into it: the posts the agent has not read,
 * so it answers what was said rather than relying on it to call channel_read.
 * Nothing is marked read until `markRead`, as the turn is handed over, so
 * channel_read in that turn goes on from the posts it was shown. A refused or
 * failed turn takes that back, and delivers the same posts again. A notice with nothing to show (the agent caught up during the
 * turn it waited behind) is dropped.
 */
export async function withChannelPosts<
  M extends { source?: string; metadata?: MessageMetadata; renderedText: string },
>(agentSessionId: string, ownerId: string, messages: M[]) {
  const kept: M[] = []
  // Each channel's place before the notice, and the place it was shown up to.
  const read: [string, number | undefined, number][] = []

  for (const message of messages) {
    const channelId = channelIdOf(message)

    if (!channelId) {
      kept.push(message)
      continue
    }
    const channel = await agentConversations().findOne({ sessionId: channelId })

    if (!channel) {
      kept.push(message)
      continue
    }
    const page = await readChannelMessages(channel, agentSessionId, ownerId, true)

    if (page.messages.length === 0) continue
    if (page.upTo !== undefined)
      read.push([channelId, channel.agentReadIndex?.[agentSessionId], page.upTo])
    const channelPost = message.metadata && (await newestPost(channel, page))

    kept.push({
      ...message,
      // What people see of it: the newest post, as the agent got it.
      ...(channelPost ? { metadata: { ...message.metadata!, channelPost } } : {}),
      // From the bare notice, so a requeued one does not carry its posts twice.
      renderedText: `${channelNotice(channelId)}\n\n${channelPage(page)}`,
    })
  }

  return {
    messages: kept,
    /** Marks the posts read; what it returns takes that back. */
    markRead: async () => {
      for (const [channelId, , upTo] of read) await markChannelRead(channelId, agentSessionId, upTo)

      return async () => {
        for (const [channelId, from, upTo] of read)
          await unmarkChannelRead(channelId, agentSessionId, from, upTo)
      }
    },
  }
}

function channelPage(page: Awaited<ReturnType<typeof readChannelMessages>>): string {
  const files = page.messages.some((message) => message.uploads)

  return JSON.stringify(
    {
      ...page,
      messages: page.messages.map(({ uploads, ...message }) =>
        uploads ? { ...message, files: uploads.length } : message,
      ),
      note:
        page.note +
        (files
          ? ' Call channel_read to get the files posted with these messages on this runtime.'
          : '') +
        (page.more ? ' More was posted: call channel_read for the rest.' : ''),
    },
    null,
    2,
  )
}

/** How a Pi turn the model provider refused reads after `Internal error: ` (acp-shim.mjs). */
const PROVIDER_REFUSED = 'The model provider refused the request:'

/**
 * Why an agent could not reply, in words fit for the chat; undefined for an internal error,
 * except a model provider's refusal.
 */
function replyFailedReason(
  agent: AgentConversation | null,
  cause: ReplyFailedCause,
  error: unknown,
  resetsAt: string | undefined,
): string | undefined {
  const label = agent?.agentRuntime ? `${runtimeLabel(agent.agentRuntime)} ` : ''
  // Claude Code's own notice names the window and its reset in UTC: kept when no reading says when.
  const notice = resetsAt ? undefined : claudeNotice(error)

  if (cause === 'usage_limit')
    return notice
      ? `its ${label}account hit its usage limit (${notice}).`
      : `its ${label}account hit its usage limit.`
  if (cause === 'auth') return `its ${label}sign-in is no longer valid.`
  if (cause === 'cli') return AGENT_CLI_UNSTARTABLE_MESSAGE
  // A disabled agent's own message says where to move the conversation.
  if (error instanceof AppError && error.code === 'runtime_disabled') return error.message
  if (cause === 'offline') return `its ${label}runtime could not be reached.`

  if (error instanceof AppError) return error.message

  // A provider's refusal is written for people (and its keys redacted); an adapter's other
  // internal errors may name hosts or files, so they stay out of the chat.
  return notice?.startsWith(PROVIDER_REFUSED) ? notice.slice(0, 300) : undefined
}

async function usageResetsAtOf(agent: AgentConversation): Promise<string | undefined> {
  if (!agent.teamId || !agent.runtimeId) return undefined
  // Lazy so importing this does not pull in the runtime graph.
  const { usageResetsAt } = await import('@/lib/claude-code-preview/runtime-catalog')

  return usageResetsAt(agent.teamId, agent.userId, agent.runtimeId)
}

/** An agent a post woke could not reply: the channel says what happened and why, not just the log. */
export async function noteReplyFailed(channelId: string, agentId: string, error: unknown) {
  const agent = await getConversationBySessionId(agentId).catch(() => null)
  // A CLI that cannot start is the agent's own cause too: this computer's line offers Install.
  const cause: ReplyFailedCause =
    userSetupFailure(error) === 'agent_cli_unstartable' ? 'cli' : turnFailureCause(error)
  const resetsAt =
    cause === 'usage_limit' && agent
      ? await usageResetsAtOf(agent).catch(() => undefined)
      : undefined
  const reason = replyFailedReason(agent, cause, error, resetsAt)
  const atMessage = (await getConversationBySessionId(channelId).catch(() => null))?.messageCount

  await agentConversations()
    .updateOne(
      // A runtime that keeps dropping fails the same wake again: one line per post (#3332).
      atMessage === undefined
        ? { sessionId: channelId }
        : {
            sessionId: channelId,
            timelineEvents: {
              $not: { $elemMatch: { kind: 'agent_reply_failed', agentId, atMessage } },
            },
          },
      {
        $push: pushTimelineEvent({
          kind: 'agent_reply_failed',
          at: new Date(),
          actorId: 'system',
          agentId,
          agentName: agent?.title || 'Nuphos agent',
          cause,
          ...(reason ? { reason } : {}),
          ...(resetsAt ? { resetsAt } : {}),
          ...(atMessage === undefined ? {} : { atMessage }),
        }),
      },
    )
    // The failure itself is already logged; a lost notice must not fail the post.
    .catch(() => undefined)
}
