import { randomUUID } from 'node:crypto'

import { getTeamMembership } from '@/lib/identity'
import { logError } from '@/lib/observability'

import { agentMessages, appendConversationMessages, getConversationBySessionId } from './db'
import {
  channelNotice,
  channelNoticeSender,
  noteReplyFailed,
  steerQueuedNotice,
  steerRunningTurn,
} from './channel-wake'
import { isChannel, postText } from './db/channels'
import { bumpConversationActivity } from './db/read-state'
import { pushTimelineEvent } from './db/participants'
import { agentConversations } from './db/shared'
import { parseMessageMetadata } from './message-metadata'
import { noteMentions } from './mentions'
import { listPendingUserMessages } from './pending-queue'

import type { AgentConversation } from './db'
import type { MessageMetadata } from './message-metadata'

/**
 * Turns agents may wake each other for between two posts by a person. Every
 * message wakes every other agent in the channel, so agents answering agents
 * multiply fast; past this they wait for someone to speak.
 */
export const CHANNEL_AGENT_TURN_BUDGET = 10

type Post = { id: string; text: string; metadata: MessageMetadata; files?: object[] }

// Enough of the original to recognize it; the reply is about it, not a copy of it.
const REPLY_QUOTE_LENGTH = 200

/**
 * What a reply quotes: a snapshot of the post `messageId` in this channel, so
 * the quote stays when the original goes. None for a post the channel lacks.
 */
export async function replyQuote(
  channel: Pick<AgentConversation, 'sessionId' | 'userId'>,
  messageId: unknown,
): Promise<MessageMetadata['replyTo']> {
  if (typeof messageId !== 'string' || !messageId || messageId.length > 100) return undefined
  const original = await agentMessages().findOne({
    sessionId: channel.sessionId,
    userId: channel.userId,
    messageId,
  })
  const sender = parseMessageMetadata(original?.metadata)?.sender

  if (!original || !sender) return undefined
  // A post of files alone is quoted as its file.
  const text = Array.from(postText(original.parts).trim()).slice(0, REPLY_QUOTE_LENGTH).join('')

  return { id: messageId, authorName: sender.displayName, text: text || 'File' }
}

/**
 * Records a message, with its `files` parts. A person's post wakes the channel's
 * agents now; an agent's (`authorSessionId`) waits for its turn to end, so all
 * it said that turn wakes the others once. A resent id is stored and announced once.
 */
export async function postChannelMessage(
  channel: AgentConversation,
  post: Post,
  authorSessionId?: string,
): Promise<boolean> {
  const teamId = channel.teamId

  if (!teamId) return false
  if (
    await agentMessages().findOne(
      { sessionId: channel.sessionId, userId: channel.userId, messageId: post.id },
      { projection: { _id: 1 } },
    )
  )
    return false
  await appendConversationMessages({
    sessionId: channel.sessionId,
    userId: channel.userId,
    teamId,
    messages: [
      {
        id: post.id,
        role: 'user',
        parts: [...(post.text ? [{ type: 'text', text: post.text }] : []), ...(post.files ?? [])],
        metadata: post.metadata,
      },
    ],
  })
  await bumpConversationActivity(channel.sessionId, channel.userId)
  await noteMentions({ ...channel, teamId }, post)
  if (authorSessionId)
    await agentConversations().updateOne(
      { sessionId: authorSessionId },
      { $addToSet: { channelWakes: channel.sessionId } },
    )
  else await wakeChannelAgents({ ...channel, teamId }, undefined)

  return true
}

/**
 * An agent's turn ended: each channel it posted in wakes its other agents once,
 * with everything it said, spending one turn per agent woken.
 */
export async function wakeAfterTurn(agentSessionId: string): Promise<void> {
  const agent = await agentConversations().findOneAndUpdate(
    { sessionId: agentSessionId, channelWakes: { $exists: true } },
    { $unset: { channelWakes: '' } },
    { returnDocument: 'before' },
  )

  for (const channelId of agent?.channelWakes ?? []) {
    const channel = await getConversationBySessionId(channelId)

    if (channel?.teamId && isChannel(channel))
      await wakeChannelAgents({ ...channel, teamId: channel.teamId }, agentSessionId)
  }
}

async function wakeChannelAgents(
  channel: AgentConversation & { teamId: string },
  authorSessionId: string | undefined,
): Promise<void> {
  const recipients = (channel.agentSessionIds ?? []).filter((id) => id !== authorSessionId)

  if (recipients.length === 0) return
  // A person speaking refills the budget; an agent spends it, one turn per agent woken.
  if (!authorSessionId)
    await agentConversations().updateOne(
      { sessionId: channel.sessionId },
      { $set: { agentTurns: 0 } },
    )
  await Promise.all(
    recipients.map((sessionId) =>
      notifyAgent(channel, sessionId, authorSessionId !== undefined).catch((error: unknown) => {
        logError('agent.channel.wake_failed', error, {
          channel_id: channel.sessionId,
          session_id: sessionId,
        })

        return noteReplyFailed(channel.sessionId, sessionId, error)
      }),
    ),
  )
}

/**
 * Posts in a channel in this agent's name. channel_post is the only way an agent
 * speaks there: a channel-woken turn's own text stays in its transcript.
 */
export async function postAsAgent(
  channelId: string,
  agent: Pick<AgentConversation, 'sessionId' | 'title' | 'agentRuntime'>,
  text: string,
  files: object[] = [],
): Promise<void> {
  const channel = await getConversationBySessionId(channelId)

  if (!channel || !isChannel(channel) || !channel.agentSessionIds?.includes(agent.sessionId)) return
  await postChannelMessage(
    channel,
    {
      id: randomUUID(),
      text,
      metadata: {
        version: 1,
        sender: {
          type: 'agent',
          id: agent.sessionId,
          displayName: agent.title || 'Nuphos agent',
          ...(agent.agentRuntime ? { agentRuntime: agent.agentRuntime } : {}),
        },
        source: 'agent.thread',
        sourceSessionId: agent.sessionId,
        sentAt: new Date().toISOString(),
      },
      files,
    },
    agent.sessionId,
  )
}

/** One more agent-woken turn, if the budget has room for it. */
async function spendTurn(channelId: string): Promise<boolean> {
  const spent = await agentConversations().updateOne(
    {
      sessionId: channelId,
      $or: [
        { agentTurns: { $exists: false } },
        { agentTurns: { $lte: CHANNEL_AGENT_TURN_BUDGET - 1 } },
      ],
    },
    { $inc: { agentTurns: 1 } },
  )

  return spent.matchedCount > 0
}

/**
 * The first time agents hit the budget, the channel says so once: the counter
 * steps past the budget, so a later refusal finds nothing to note.
 */
async function notePause(channelId: string) {
  await agentConversations().updateOne(
    { sessionId: channelId, agentTurns: CHANNEL_AGENT_TURN_BUDGET },
    {
      $inc: { agentTurns: 1 },
      $push: pushTimelineEvent({
        kind: 'agents_paused',
        at: new Date(),
        actorId: 'system',
        turns: CHANNEL_AGENT_TURN_BUDGET,
      }),
    },
  )
}

/**
 * Tells an agent its channel has news. A person's post reaches a running turn
 * at once, steered in like a follow-up typed in the conversation, or as soon as
 * a starting turn can take it; otherwise an idle agent starts a turn now and a
 * busy one finds the notice in its queue when that turn ends. One notice per agent and channel waits at a time, and the
 * agent then reads all of it, so a second notice is dropped here and costs
 * nothing.
 */
async function notifyAgent(
  channel: AgentConversation & { teamId: string },
  sessionId: string,
  fromAgent: boolean,
) {
  const agent = await getConversationBySessionId(sessionId)

  // An archived agent stays archived: a channel post does not wake it back.
  if (!agent?.teamId || agent.teamId !== channel.teamId || isChannel(agent) || agent.archivedAt)
    return
  // An agent runs as its owner, so it goes quiet once its owner leaves the team.
  if (!(await getTeamMembership(agent.userId, channel.teamId))) return
  // The title is a member's words, so it travels only in the metadata.
  const metadata = channelNoticeSender(
    channel.teamId,
    channel.sessionId,
    channel.title || 'Nuphos channel',
  )

  // An agent's posts still wait for the turn to end: one wake per turn (#1458).
  if (!fromAgent && (await steerRunningTurn(agent, channel.sessionId, metadata))) return
  const waiting = (await listPendingUserMessages(agent.userId, sessionId)).find(
    (message) => message.metadata?.sender?.id === metadata.sender.id,
  )
  const queued = waiting?.id ?? (await startNotice(channel, agent, metadata, fromAgent))

  // A turn still starting refused the steer above: the post must not wait for its end.
  if (queued && !fromAgent) steerQueuedNotice(agent, channel.sessionId, metadata, queued)
}

/** Starts the notice's turn, or queues it: the id of a queued notice. */
async function startNotice(
  channel: AgentConversation & { teamId: string },
  agent: AgentConversation,
  metadata: MessageMetadata,
  fromAgent: boolean,
): Promise<string | undefined> {
  if (fromAgent && !(await spendTurn(channel.sessionId))) {
    await notePause(channel.sessionId)

    return undefined
  }
  const messageId = randomUUID()
  // Lazy so importing this does not pull in the route graph.
  const { startConversationTurn } = await import('./conversation-turn')
  const { status, run } = await startConversationTurn(
    {
      userId: agent.userId,
      teamId: channel.teamId, // The agent's too: only the channel's team wakes.
      targetSessionId: agent.sessionId,
      messageId,
      locale: agent.metadata?.locale ?? 'en-US',
    },
    agent,
    // Fixed per channel, so the queue's dedupe keeps one.
    channelNotice(channel.sessionId),
    'agent.resource',
    metadata,
  )

  run.catch((error: unknown) => {
    logError('agent.channel.turn_failed', error, {
      channel_id: channel.sessionId,
      session_id: agent.sessionId,
    })

    return noteReplyFailed(channel.sessionId, agent.sessionId, error)
  })

  return status === 'queued' ? messageId : undefined
}
