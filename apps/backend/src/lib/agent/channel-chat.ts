import { randomUUID } from 'node:crypto'

import { getTeamMembership } from '@/lib/identity'
import { logError } from '@/lib/observability'

import { agentMessages, appendConversationMessages, getConversationBySessionId } from './db'
import { channelNotice } from './db/channel-notes'
import { channelNoticeSender, steerQueuedNotice, steerRunningTurn } from './channel-wake'
import { noteReplyFailed } from './reply-failed'
import { replyQuote } from './channel-reply'
import { chatName, isChannel } from './db/channels'
import { bumpConversationActivity } from './db/read-state'
import { clearReplyFailed, pushTimelineEvent } from './db/participants'
import { agentConversations } from './db/shared'
import { notePost } from './mentions'
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
  await notePost({ ...channel, teamId }, post, authorSessionId !== undefined)
  if (authorSessionId) {
    // It replied: its couldn't-reply line no longer says how it is.
    await clearReplyFailed(channel.sessionId, authorSessionId)
    await agentConversations().updateOne(
      { sessionId: authorSessionId },
      { $addToSet: { channelWakes: channel.sessionId } },
    )
  } else await wakeChannelAgents({ ...channel, teamId }, undefined)

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

export async function wakeChannelAgents(
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
  /** The index of the one post it answers, which it then quotes unless that post is the newest. */
  replyTo?: number,
): Promise<void> {
  const channel = await getConversationBySessionId(channelId)

  if (!channel || !isChannel(channel) || !channel.agentSessionIds?.includes(agent.sessionId)) return
  const quote = await replyQuote(channel, replyTo)
  // Answering the newest post needs no quote: the reply lands right under it.
  // A Slack channel keeps it, as its threads follow the quotes.
  const shown =
    quote &&
    (channel.external === 'slack' ||
      (await agentMessages().findOne(
        { sessionId: channel.sessionId, userId: channel.userId, index: { $gt: replyTo } },
        { projection: { _id: 1 } },
      )))
  // A Slack channel's people are in Slack: the post is a Slack message, or nothing.
  const id =
    channel.external === 'slack'
      ? await slackPost(channel, agent, text, files, quote)
      : randomUUID()

  await postChannelMessage(
    channel,
    {
      id,
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
        ...(shown ? { replyTo: quote } : {}),
      },
      files,
    },
    agent.sessionId,
  )
}

async function slackPost(
  channel: AgentConversation,
  agent: Pick<AgentConversation, 'title'>,
  text: string,
  files: object[],
  quote: MessageMetadata['replyTo'],
) {
  if (files.length > 0) throw new Error('Files cannot be posted to a Slack channel yet.')
  // Lazy so importing this does not pull in the Slack client.
  const { postToSlack } = await import('@/lib/slack/external-chat-post')

  return await postToSlack(channel, agent, text, quote)
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
export async function notifyAgent(
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
  const metadata = channelNoticeSender(channel.teamId, channel, wakeName(channel))

  // An agent's posts still wait for the turn to end: one wake per turn (#1458).
  if (!fromAgent && (await steerRunningTurn(agent, channel, metadata))) return
  const waiting = (await listPendingUserMessages(agent.userId, sessionId)).find(
    (message) => message.metadata?.sender?.id === metadata.sender.id,
  )
  const queued = waiting?.id ?? (await startNotice(channel, agent, metadata, fromAgent))

  // A turn still starting refused the steer above: the post must not wait for its end.
  if (queued && !fromAgent) steerQueuedNotice(agent, channel, metadata, queued)
}

/** What the Bot's own conversation calls the chat that woke it: a Slack channel by its Slack name. */
export const wakeName = (channel: AgentConversation) =>
  channel.external === 'slack'
    ? `Slack #${(channel.title ?? '').replace(/^#/, '')}`
    : chatName(channel) || 'Nuphos channel'

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
    channelNotice(channel),
    'agent.resource',
    metadata,
  )

  // The channel already has its line: runTurn reports a notice it could not run.
  run.catch((error: unknown) => {
    logError('agent.channel.turn_failed', error, {
      channel_id: channel.sessionId,
      session_id: agent.sessionId,
    })
  })

  return status === 'queued' ? messageId : undefined
}
