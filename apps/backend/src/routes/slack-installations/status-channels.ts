import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { listSlackChannelMappings } from '@/lib/slack/agent-bot'
import { slackApi } from '@/lib/slack/api'
import {
  filterVisibleSlackChannels,
  getJoinedSlackChannel,
  listJoinedSlackChannels,
} from '@/lib/slack/destinations'
import {
  getSlackBindingForTeam,
  resolveInstalledWorkspaceBot,
  resolveSlackBotForTeam,
} from '@/lib/slack/installations'
import { isSlackOAuthConfigured } from '@/lib/slack/oauth'

import type { SlackJoinedChannel } from '@/lib/slack/destinations'
import type { TeamAuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

export function registerSlackInstallationStatusRoutes(
  slackInstallationsRoutes: Hono<{ Variables: TeamAuthVariables }>,
): void {
  slackInstallationsRoutes.get('/status', async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await getSlackBindingForTeam(teamId)

    if (binding) {
      try {
        const bot = await resolveSlackBotForTeam(teamId)

        if (!bot) {
          return c.json({
            configured: true,
            connected: false,
            oauthAvailable: isSlackOAuthConfigured(),
          })
        }
        const auth = await slackApi(bot.botToken, 'auth.test', {})

        return c.json({
          configured: true,
          connected: true,
          oauthAvailable: isSlackOAuthConfigured(),
          installed: true,
          botUserId: binding.botUserId,
          botName: auth.user ?? binding.botUserId,
          slackWorkspaceId: binding.slackTeamId,
          slackWorkspaceName: binding.slackTeamName,
        })
      } catch (err) {
        return c.json({
          configured: true,
          connected: false,
          installed: true,
          oauthAvailable: isSlackOAuthConfigured(),
          botUserId: binding.botUserId,
          slackWorkspaceId: binding.slackTeamId,
          slackWorkspaceName: binding.slackTeamName,
          error: err instanceof AppError ? err.message : 'Slack connection check failed',
        })
      }
    }

    const legacy = await resolveSlackBotForTeam(teamId)

    if (legacy && legacy.binding.slackTeamId === '') {
      // This team has no per-team OAuth binding; it is falling back to the shared,
      // server-wide SLACK_BOT_TOKEN. The bot is reachable, but it is NOT this
      // team's own connection — every team without a binding resolves to the same
      // global workspace. Flag it as `legacyGlobal` so the UI does not present the
      // shared bot's workspace as if this team were connected to it.
      try {
        const auth = await slackApi(legacy.botToken, 'auth.test', {})

        return c.json({
          configured: true,
          connected: true,
          installed: false,
          legacyGlobal: true,
          oauthAvailable: isSlackOAuthConfigured(),
          botUserId: legacy.botUserId || auth.user_id || null,
          botName: auth.user ?? null,
          slackWorkspaceId: auth.team_id,
          slackWorkspaceName: auth.team,
        })
      } catch (err) {
        return c.json({
          configured: true,
          connected: false,
          installed: false,
          legacyGlobal: true,
          oauthAvailable: isSlackOAuthConfigured(),
          error: err instanceof AppError ? err.message : 'Slack connection check failed',
        })
      }
    }

    return c.json({
      configured: isSlackOAuthConfigured(),
      connected: false,
      installed: false,
      oauthAvailable: isSlackOAuthConfigured(),
    })
  })

  slackInstallationsRoutes.get('/channels', async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await getSlackBindingForTeam(teamId)
    const channels: (SlackJoinedChannel & { slackWorkspaceId: string })[] = []
    let primaryWorkspaceId: string | null = null

    if (binding) {
      const bot = await resolveSlackBotForTeam(teamId)

      if (!bot) {
        throw new AppError(503, 'slack_not_configured', 'Slack is not installed for this team')
      }
      primaryWorkspaceId = binding.slackTeamId
      channels.push(
        ...(await listJoinedSlackChannels(bot.botToken)).map((channel) => ({
          ...channel,
          slackWorkspaceId: binding.slackTeamId,
        })),
      )
    }

    // Channels granted to this team via enabled channel mappings from other
    // workspaces' installations — the same channel-scoped access the agent's
    // outbound tools use.
    const grants = (await listSlackChannelMappings(teamId.toHexString())).filter(
      (mapping) => mapping.enabled && mapping.slackWorkspaceId !== binding?.slackTeamId,
    )
    const grantWorkspaceIds = [...new Set(grants.map((mapping) => mapping.slackWorkspaceId))]

    for (const workspaceId of grantWorkspaceIds) {
      const workspaceBot = await resolveInstalledWorkspaceBot(workspaceId).catch(() => null)

      if (!workspaceBot) continue
      primaryWorkspaceId ??= workspaceId
      for (const grant of grants.filter((entry) => entry.slackWorkspaceId === workspaceId)) {
        try {
          channels.push({
            ...(await getJoinedSlackChannel(workspaceBot.botToken, grant.slackChannelId)),
            slackWorkspaceId: workspaceId,
          })
        } catch {
          // Bot not in the mapped channel (or archived): not a usable
          // destination, so it is omitted rather than failing the listing.
        }
      }
    }

    if (!primaryWorkspaceId) {
      throw new AppError(503, 'slack_not_configured', 'Slack is not installed for this team')
    }

    return c.json({
      slackWorkspaceId: primaryWorkspaceId,
      channels: filterVisibleSlackChannels(channels, c.get('teamRole') === 'ADMINISTRATOR'),
    })
  })
}
