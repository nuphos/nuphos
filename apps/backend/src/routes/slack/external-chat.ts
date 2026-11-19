import { postChannelMessage } from '@/lib/agent/channel-chat'
import { replyQuote } from '@/lib/agent/channel-reply'
import { getConversationBySessionId } from '@/lib/agent/db'
import { isChannel } from '@/lib/agent/db/channels'
import { getTeamMembers } from '@/lib/identity'
import { logError, logEvent } from '@/lib/observability'
import { getSlackChannelMapping, getSlackUserMapping, markSlackEvent } from '@/lib/slack/agent-bot'
import { slackApiGet } from '@/lib/slack/api'
import { resolveSlackBotForWorkspace } from '@/lib/slack/installations'
import { resolveSlackMentionNames } from '@/routes/slack/render'
import { SUBTYPES_WITH_ATTACHMENTS } from '@/routes/slack/shared'

import type { MessageMetadata } from '@/lib/agent/message-metadata'
import type { SlackUserMapping } from '@/lib/slack/agent-bot'
import type { SlackEventEnvelope, SlackMessageEvent } from '@/routes/slack/types'

/**
 * A Slack channel that is an external chat (#3702): the Bots talk in Slack, and
 * a hidden record holds what they read there. Each person's message becomes a
 * post in that record, which wakes its Bots as any chat post does.
 * True when the channel is connected, so no other handler takes the event. A
 * mention arrives as a message too, so `app_mention` adds nothing.
 */
export async function routeSlackToExternalChat(envelope: SlackEventEnvelope): Promise<boolean> {
  const { event, event_id: eventId, team_id: slackWorkspaceId } = envelope

  if (!event?.channel || !eventId || !slackWorkspaceId || event.channel_type === 'im') return false
  const mapping = await getSlackChannelMapping(slackWorkspaceId, event.channel)

  if (!mapping?.externalChatId) return false
  const posted =
    event.type === 'message' &&
    (await postFromSlack(slackWorkspaceId, mapping.teamId, mapping.externalChatId, event))

  await markSlackEvent(eventId, posted ? 'completed' : 'ignored')

  return true
}

async function postFromSlack(
  slackWorkspaceId: string,
  teamId: string,
  externalChatId: string,
  event: SlackMessageEvent,
): Promise<boolean> {
  const bot = await resolveSlackBotForWorkspace(slackWorkspaceId)
  const post = bot && personPost(event, bot.botUserId)

  if (!bot || !post) return false
  const { channel: slackChannelId, user: slackUserId, ts, text: raw } = post
  const chat = await getConversationBySessionId(externalChatId)

  if (!chat || !isChannel(chat) || chat.external !== 'slack' || chat.teamId !== teamId) {
    logEvent('warn', 'slack.external_chat.unavailable', {
      team_id: teamId,
      external_chat_id: externalChatId,
    })

    return false
  }
  const metadata = await resolveSlackSender({
    botToken: bot.botToken,
    slackWorkspaceId,
    teamId,
    slackUserId,
    userTeam: event.user_team,
  })
  const rootId = event.thread_ts && event.thread_ts !== ts ? event.thread_ts : undefined
  const replyTo = rootId && (await replyQuote(chat, slackPostId(slackChannelId, rootId)))
  const text = await resolveSlackMentionNames(bot.botToken, slackWorkspaceId, raw)

  // Attributed to a teammate it may be, but posting from Slack adds no one to the chat.
  return await postChannelMessage(chat, {
    // Slack's own id for the message, so a redelivery is the same post.
    id: slackPostId(slackChannelId, ts),
    text,
    metadata: replyTo ? { ...metadata, replyTo } : metadata,
  })
}

/** A person's words, with what they need to become a post: never this app's, another bot's, an edit or a join. */
function personPost(event: SlackMessageEvent, botUserId: string) {
  const { channel, user, ts, text } = event

  if (!channel || !user || !ts || !text?.trim() || event.bot_id || user === botUserId) return null
  if (event.subtype && !SUBTYPES_WITH_ATTACHMENTS.has(event.subtype)) return null

  return { channel, user, ts, text }
}

export const slackPostId = (slackChannelId: string, ts: string) => `slack:${slackChannelId}:${ts}`

/**
 * Who a Slack message is from. A team member when their Slack account is linked,
 * or when users.info reports them in this workspace with a member's email. A
 * Slack Connect member's email is their own org's to set, so it never counts,
 * nor does an email link the old mention path wrote. Anyone else is their Slack
 * identity alone: unattested, so never the owner, and the model reads them fenced.
 */
export async function resolveSlackSender(args: {
  botToken: string
  slackWorkspaceId: string
  teamId: string
  slackUserId: string
  userTeam?: string
}): Promise<MessageMetadata> {
  const { slackWorkspaceId, teamId, slackUserId } = args
  const [link, members, user] = await Promise.all([
    getSlackUserMapping(slackWorkspaceId, teamId, slackUserId),
    getTeamMembers(teamId),
    slackUser(args.botToken, slackUserId),
  ])
  const member = findMember(members, link, user, args)
  const sentAt = new Date().toISOString()

  if (member)
    return {
      version: 1,
      sender: { type: 'user', id: member.id, displayName: member.name || member.email },
      source: 'slack',
      sentAt,
    }

  return {
    version: 1,
    sender: {
      type: 'user',
      id: `slack:${slackWorkspaceId}:${slackUserId}`,
      displayName: slackName(user) ?? slackUserId,
    },
    source: 'slack',
    sentAt,
    unattested: true,
  }
}

type SlackUser = NonNullable<Awaited<ReturnType<typeof slackUser>>>
type Member = Awaited<ReturnType<typeof getTeamMembers>>[number]

function findMember(
  members: Member[],
  link: SlackUserMapping | null,
  user: SlackUser | null,
  where: { slackWorkspaceId: string; userTeam?: string },
): Member | undefined {
  if (link && link.createdBy !== 'auto:slack-email')
    return members.find((member) => member.id === link.nuphosUserId)
  const ownWorkspace =
    user?.team_id === where.slackWorkspaceId &&
    (!where.userTeam || where.userTeam === where.slackWorkspaceId)
  const email = user?.profile?.email?.trim().toLowerCase()

  if (!ownWorkspace || !email) return undefined

  return members.find((member) => member.email.trim().toLowerCase() === email)
}

function slackName(user: SlackUser | null): string | undefined {
  const names = [user?.profile?.display_name, user?.profile?.real_name, user?.real_name]

  return names.map((name) => name?.trim()).find(Boolean)
}

async function slackUser(botToken: string, slackUserId: string) {
  try {
    const { user } = await slackApiGet(botToken, 'users.info', { user: slackUserId })

    return user && typeof user === 'object' ? user : null
  } catch (error) {
    logError('slack.external_chat.users_info_failed', error, { slack_user_id: slackUserId })

    return null
  }
}
