import { logError } from '@/lib/observability'
import { markSlackEvent } from '@/lib/slack/agent-bot'
import { publishSlackHomeView } from '@/lib/slack/api'
import { buildConnectedSlackHomeView, buildDisconnectedSlackHomeView } from '@/lib/slack/home-tab'
import { resolveSlackBotForWorkspace } from '@/lib/slack/installations'
import { resolveSlackUserMapping } from '@/routes/slack/identity'

import type { SlackEventEnvelope } from '@/routes/slack/types'

// Builds and publishes the viewer's Home tab. Shared by app_home_opened, the
// Refresh button, and the home-tab channel select (all of which want a fresh
// view afterwards). Resolves the viewer's user mapping through the same
// email-auto-link as the message handlers, so a first visit to the Home tab
// typically links the account by itself.
export async function publishHomeTabForUser(args: {
  slackWorkspaceId: string
  slackUserId: string
}): Promise<void> {
  const botContext = await resolveSlackBotForWorkspace(args.slackWorkspaceId)

  if (!botContext) return
  let view: Record<string, unknown>

  if (!botContext.nuphosTeamId) {
    view = buildDisconnectedSlackHomeView()
  } else {
    const { mapping } = await resolveSlackUserMapping(
      args.slackWorkspaceId,
      botContext.nuphosTeamId,
      args.slackUserId,
      botContext.botToken,
    )

    view = await buildConnectedSlackHomeView({
      slackWorkspaceId: args.slackWorkspaceId,
      slackTeamName: botContext.binding.slackTeamName,
      botUserId: botContext.botUserId,
      nuphosTeamId: botContext.nuphosTeamId,
      nuphosUserId: mapping?.nuphosUserId ?? null,
    })
  }
  await publishSlackHomeView({
    token: botContext.botToken,
    slackUserId: args.slackUserId,
    view,
  })
}

export async function handleAppHomeOpened(envelope: SlackEventEnvelope): Promise<void> {
  const event = envelope.event
  const eventId = envelope.event_id
  const slackWorkspaceId = envelope.team_id

  if (!event || !eventId || !slackWorkspaceId) return
  // app_home_opened also fires for the Messages tab; only 'home' has a view.
  if (event.tab !== 'home' || !event.user) {
    await markSlackEvent(eventId, 'ignored')

    return
  }
  const botContext = await resolveSlackBotForWorkspace(slackWorkspaceId)

  if (!botContext) {
    await markSlackEvent(eventId, 'failed', 'No Slack bot configured for this workspace')

    return
  }
  try {
    await publishHomeTabForUser({ slackWorkspaceId, slackUserId: event.user })
  } catch (err) {
    // Handled here rather than by the /events catch-all: its thread-reply
    // fallback would post into the App Home conversation, which is noise. The
    // tab simply stays on its previous view; the user retries by reopening it.
    logError('slack.home.publish.error', err, {
      slack_workspace_id: slackWorkspaceId,
      slack_user_id: event.user,
    })
    await markSlackEvent(eventId, 'failed', err instanceof Error ? err.message : String(err))

    return
  }
  await markSlackEvent(eventId, 'completed')
}
