import { randomUUID } from 'node:crypto'

import { getTeamMembers, getTeamMembership } from '@/lib/identity'
import { logError } from '@/lib/observability'

import { persistedMessageToUiMessage } from '@/routes/mcp/transcript'

import {
  agentMessages,
  appendConversationMessages,
  getConversationBySessionId,
  getConversationWithMessages,
} from './db'
import { CHANNEL_SENDER_PREFIX, isChannel } from './db/channels'
import { pushTimelineEvent } from './db/participants'
import { agentConversations } from './db/shared'
import { listPendingUserMessages } from './pending-queue'

import type { AgentConversation } from './db'
import type { MessageMetadata } from './message-metadata'
import type { PendingUserMessage } from './pending-messages'
import type { UIMessage } from 'ai'

/**
 * Turns agents may wake each other for between two posts by a person. Every
 * message wakes every other agent in the channel, so agents answering agents
 * multiply fast; past this they wait for someone to speak.
 */
export const CHANNEL_AGENT_TURN_BUDGET = 10

type Post = { id: string; text: string; metadata: MessageMetadata }

/**
 * Records a message in a channel and wakes its other agents. `authorSessionId` is
 * the posting agent's session; a person's post has none. A resent id is the
 * same message, so it is neither stored nor announced twice.
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
        parts: [{ type: 'text', text: post.text }],
        metadata: post.metadata,
      },
    ],
  })
  await noteMentions({ ...channel, teamId }, post)
  await wakeChannelAgents({ ...channel, teamId }, authorSessionId)

  return true
}

/**
 * Who this post @mentions, among the channel's people, by the `@Name` the
 * composer and agents write. Each keeps an Inbox entry until they post here.
 */
async function noteMentions(channel: AgentConversation & { teamId: string }, post: Post) {
  const author = post.metadata.sender.type === 'user' ? post.metadata.sender.id : undefined
  const people = new Set([channel.userId, ...(channel.participantIds ?? [])])
  const mentioned = post.text.includes('@')
    ? (await getTeamMembers(channel.teamId)).filter(
        (member) =>
          people.has(member.id) && member.id !== author && post.text.includes(`@${member.name}`),
      )
    : []
  const set = Object.fromEntries(
    mentioned.map((member) => [`mentions.${member.id}`, { messageId: post.id, at: new Date() }]),
  )

  if (mentioned.length === 0 && !author) return
  await agentConversations().updateOne(
    { sessionId: channel.sessionId },
    {
      ...(mentioned.length > 0 ? { $set: set } : {}),
      ...(author ? { $unset: { [`mentions.${author}`]: '' } } : {}),
    },
  )
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
      }),
    ),
  )
}

/**
 * A channel-woken turn's closing words are its reply, as a person's last words
 * in a group chat are what they said. Saying nothing leaves nothing behind.
 */
async function postTurnReply(
  channelId: string,
  agent: Pick<AgentConversation, 'sessionId' | 'title' | 'agentRuntime'>,
  text: string,
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
    },
    agent.sessionId,
  )
}

/** The last text of the turn's closing message: what the agent said, not what it did. */
function closingWords(message: UIMessage): string {
  const last = message.parts.findLastIndex(
    (part) => part.type !== 'text' && part.type !== 'step-start',
  )

  return message.parts
    .slice(last + 1)
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('')
    .trim()
}

/** A turn woken by a channel answers there with what it ends on; silence posts nothing. */
export async function replyToChannel(
  data: { userId: string; teamId: string; targetSessionId: string },
  target: AgentConversation,
  fresh: readonly Pick<PendingUserMessage, 'metadata'>[],
): Promise<void> {
  const channelId = fresh
    .map((message) => message.metadata?.sender?.id)
    .find((id) => id?.startsWith(CHANNEL_SENDER_PREFIX))
    ?.slice(CHANNEL_SENDER_PREFIX.length)

  if (!channelId) return
  const after = await getConversationWithMessages(data.targetSessionId, data.userId, data.teamId)
  const reply = after?.messages.findLast((message) => message.role === 'assistant')
  const ui = reply && persistedMessageToUiMessage(reply)
  const text = ui ? closingWords(ui) : ''

  if (text) await postTurnReply(channelId, target, text)
}

const senderId = (channelId: string) => `${CHANNEL_SENDER_PREFIX}${channelId}`

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
 * Tells an agent its channel has news, never interrupting it: idle, it starts
 * a turn now; busy, the notice waits in its queue until that turn ends. One
 * notice per agent and channel waits at a time, and the agent then reads all
 * of it with channel_read, so a second notice is dropped here and costs
 * nothing.
 */
async function notifyAgent(
  channel: AgentConversation & { teamId: string },
  sessionId: string,
  fromAgent: boolean,
) {
  const agent = await getConversationBySessionId(sessionId)

  if (!agent?.teamId || agent.teamId !== channel.teamId || isChannel(agent)) return
  // An agent runs as its owner, so it goes quiet once its owner leaves the team.
  if (!(await getTeamMembership(agent.userId, channel.teamId))) return
  const waiting = await listPendingUserMessages(agent.userId, sessionId)

  if (waiting.some((message) => message.metadata?.sender?.id === senderId(channel.sessionId)))
    return
  if (fromAgent && !(await spendTurn(channel.sessionId))) {
    await notePause(channel.sessionId)

    return
  }
  // Lazy so importing this does not pull in the route graph.
  const { startConversationTurn } = await import('./conversation-turn')
  const { run } = await startConversationTurn(
    {
      userId: agent.userId,
      teamId: agent.teamId,
      targetSessionId: sessionId,
      messageId: randomUUID(),
      locale: agent.metadata?.locale ?? 'en-US',
    },
    agent,
    // Fixed per channel, so the queue's dedupe keeps one; the title is a
    // member's words and travels only in the metadata.
    `New messages in a Nuphos channel (channelId ${channel.sessionId}).`,
    'agent.resource',
    {
      version: 1,
      sender: { type: 'system', id: senderId(channel.sessionId), displayName: channel.title },
      source: 'agent.resource',
      resourceUrl: `/teams/${channel.teamId}/agent/${channel.sessionId}`,
      sentAt: new Date().toISOString(),
    },
  )

  run.catch((error: unknown) => {
    logError('agent.channel.turn_failed', error, {
      channel_id: channel.sessionId,
      session_id: sessionId,
    })
  })
}
