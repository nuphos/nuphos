import type { SlackEventEnvelope } from '@/routes/slack/types'

import { getSlackAgentThread, markSlackEvent } from '@/lib/slack/agent-bot'
import { resolveSlackBotForWorkspace } from '@/lib/slack/installations'
import { postSenderNotice } from '@/routes/slack/shared'

export const NO_BOT_HERE =
  'No Bot answers in this channel yet. Choose the Bots for it in Nuphos → Settings → Slack.'

/**
 * A mention in a channel that is no external chat (#3702): a channel with Bots
 * never gets here (`routeSlackToExternalChat` takes it first), so the person
 * who mentioned the app learns, alone, that nothing answers here. A reply in a
 * notification thread is the message handler's, which Slack also sends.
 */
export async function handleAppMention(envelope: SlackEventEnvelope): Promise<void> {
  const { event, event_id: eventId, team_id: slackWorkspaceId } = envelope

  if (!event || !eventId || !slackWorkspaceId) return
  const bot = await resolveSlackBotForWorkspace(slackWorkspaceId)

  if (
    !bot ||
    !event.channel ||
    !event.user ||
    event.bot_id ||
    event.user === bot.botUserId ||
    (event.thread_ts &&
      (await getSlackAgentThread(slackWorkspaceId, event.channel, event.thread_ts))?.origin ===
        'agent_notification')
  ) {
    await markSlackEvent(eventId, 'ignored')

    return
  }
  await postSenderNotice(
    { botToken: bot.botToken, botUserId: bot.botUserId },
    event.channel,
    event.thread_ts,
    event.user,
    NO_BOT_HERE,
  )
  await markSlackEvent(eventId, 'completed')
}
