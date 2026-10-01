import { config } from '@/config'
import { slackChannelMappings, slackUserMappings } from '@/lib/slack/agent-bot/collections'

import { slackApi } from './api'

type SlackCall = (token: string, method: string, body: Record<string, unknown>) => Promise<unknown>

/**
 * Best-effort teardown of a team's Slack bot access. `apps.uninstall` removes
 * the app from the workspace outright but needs the app's own client
 * credentials; without them, revoking the bot token is the most we can do.
 * Returns which step succeeded, or null when both failed.
 */
export async function revokeSlackBotAccess(
  botToken: string,
  deps: {
    clientId?: string | null
    clientSecret?: string | null
    call?: SlackCall
    onFailure?: (step: 'uninstall' | 'revoke', err: unknown) => void
  } = {},
): Promise<'uninstall' | 'revoke' | null> {
  const call = deps.call ?? slackApi
  const clientId = deps.clientId ?? config.slack.oauth.clientId
  const clientSecret = deps.clientSecret ?? config.slack.oauth.clientSecret

  if (clientId && clientSecret) {
    try {
      await call(botToken, 'apps.uninstall', { client_id: clientId, client_secret: clientSecret })

      return 'uninstall'
    } catch (err) {
      deps.onFailure?.('uninstall', err)
    }
  }
  try {
    await call(botToken, 'auth.revoke', {})

    return 'revoke'
  } catch (err) {
    deps.onFailure?.('revoke', err)

    return null
  }
}

type DeletableMappings = {
  deleteMany(filter: {
    teamId: string
    slackWorkspaceId: string
  }): Promise<{ deletedCount: number }>
}

/**
 * Uninstalling a workspace leaves its channel/user mappings pointing at a bot
 * that no longer exists. Delete them, as the user-facing removal routes do:
 * a reinstall never re-enables mappings, and the list endpoints don't filter
 * on `enabled`, so disabled rows would linger in the settings UI. Only this
 * team's rows for this workspace — a shared workspace may still serve other
 * teams through their own mappings.
 */
export async function deleteSlackWorkspaceMappings(
  teamId: string,
  slackWorkspaceId: string,
  collections: { channels: DeletableMappings; users: DeletableMappings } = {
    channels: slackChannelMappings(),
    users: slackUserMappings(),
  },
): Promise<{ channels: number; users: number }> {
  const filter = { teamId, slackWorkspaceId }
  const [channels, users] = await Promise.all([
    collections.channels.deleteMany(filter),
    collections.users.deleteMany(filter),
  ])

  return { channels: channels.deletedCount, users: users.deletedCount }
}
