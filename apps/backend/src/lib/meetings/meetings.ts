import { randomUUID } from 'node:crypto'

import { config } from '@/config'
import { postChannelMessage } from '@/lib/agent/channel-chat'
import { getConversationBySessionId, upsertConversationShell } from '@/lib/agent/db'
import { addChannelAgent, isChannel } from '@/lib/agent/db/channels'
import { agentConversations } from '@/lib/agent/db/shared'
import { systemSender } from '@/lib/agent/message-metadata'
import { stripTrailingSlashes } from '@/lib/agent/text-scan'

import { createMeetingBot, leaveMeeting, recallConfig } from './recall'

import type { AgentConversation } from '@/lib/agent/db'

type Participant = { id?: number; name?: string | null }
export type RecallEvent = {
  event: string
  data: {
    data: { words?: { text: string }[]; participant?: Participant; data?: { text?: string } }
    bot: { id: string }
  }
}

// Like a Trigger's webhook: the public origin, unless that is the local-dev fallback.
function webhookUrl(): string {
  const publicBase = config.auth.publicBaseUrl
  const base =
    publicBase && !/\/\/localhost[:/]/i.test(publicBase) ? publicBase : config.agent.backendUrl

  return `${stripTrailingSlashes(base ?? '')}/meetings/recall/webhook`
}

async function openMeetingChannel(
  agent: AgentConversation,
  teamId: string,
  channelId: string,
  title: string,
  meeting: { botId: string; botName: string; url: string },
) {
  await upsertConversationShell({
    sessionId: channelId,
    userId: agent.userId,
    teamId,
    title,
    firstMessage: '',
    kind: 'channel',
  })
  await agentConversations().updateOne({ sessionId: channelId }, { $set: { meeting } })
  await addChannelAgent(channelId, agent.sessionId)
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Each bot opens one meeting channel, so a team's recent ones are its usage. */
export async function assertMeetingBudget(teamId: string, limit: number, now = Date.now()) {
  const since = new Date(now - DAY_MS)
  // A channel is never last active before it was created: this bound uses the
  // { teamId, lastActiveAt } index.
  const used = await agentConversations().countDocuments({
    teamId,
    lastActiveAt: { $gte: since },
    createdAt: { $gte: since },
    'meeting.botId': { $exists: true },
  })

  if (used >= limit)
    throw new Error(
      `This team has sent ${String(limit)} bots to meetings in the last 24 hours, its limit. Try again later.`,
    )
}

/**
 * Sends `agent` into the call under its own name, with a channel of its own
 * where the call's speech arrives and its posts go out to the call's chat.
 */
export async function joinMeeting(agent: AgentConversation, teamId: string, meetingUrl: string) {
  const url = new URL(meetingUrl)

  if (url.protocol !== 'https:') throw new Error('A meeting link starts with https://')
  await assertMeetingBudget(teamId, recallConfig().botsPerTeamPerDay)
  const botName = agent.title || 'Nuphos agent'
  const botId = await createMeetingBot({ meetingUrl: url.href, botName, webhookUrl: webhookUrl() })
  const channelId = randomUUID()

  try {
    const title = `Meeting ${url.pathname.replace(/^\//, '') || url.host}`

    await openMeetingChannel(agent, teamId, channelId, title, { botId, botName, url: url.href })
  } catch (error) {
    // No channel to hear it, so the bot leaves rather than sit in the call.
    await leaveMeeting(botId).catch(() => undefined)
    throw error
  }

  return { channelId, url: `/teams/${teamId}/agent/${channelId}` }
}

export async function leaveMeetingChannel(channelId: string, agentSessionId: string) {
  const channel = await getConversationBySessionId(channelId)

  if (!channel?.meeting || !channel.agentSessionIds?.includes(agentSessionId))
    throw new Error('This conversation is not in that meeting.')
  await leaveMeeting(channel.meeting.botId)
}

// CJK recognizers emit a word per character: no spaces between those.
const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/u

export function joinWords(words: readonly { text: string }[]): string {
  return words
    .map((word) => word.text.trim())
    .filter(Boolean)
    .reduce((text, word) => {
      const glued = CJK.test(text.slice(-1)) && CJK.test(word[0] ?? '')

      return text && !glued ? `${text} ${word}` : text + word
    }, '')
}

/** What a Recall event says, or nothing for the bot's own chat and empty speech. */
export function eventText(event: RecallEvent, botName: string): string | undefined {
  const { words, participant, data } = event.data.data

  if (event.event === 'transcript.data') return joinWords(words ?? []) || undefined
  if (event.event !== 'participant_events.chat_message' || participant?.name === botName) return
  const text = data?.text?.trim()

  return text ? `[chat] ${text}` : undefined
}

/** One Recall delivery becomes one post from its speaker; a redelivery is stored once. */
export async function handleRecallEvent(deliveryId: string, event: RecallEvent): Promise<void> {
  const channel = await agentConversations().findOne({
    kind: 'channel',
    'meeting.botId': event.data.bot.id,
  })

  if (!channel?.meeting || !isChannel(channel)) return
  const text = eventText(event, channel.meeting.botName)

  if (!text) return
  const speaker = event.data.data.participant

  await postChannelMessage(channel, {
    id: deliveryId,
    text,
    metadata: systemSender(`meeting:${speaker?.id ?? 'unknown'}`, speaker?.name || 'Participant'),
  })
}
