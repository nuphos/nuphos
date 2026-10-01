import { AppError } from '@/lib/errors'
import { getTeamsByIds } from '@/lib/identity'
import { logEvent } from '@/lib/observability'
import {
  deleteSlackChannelMapping,
  listSlackChannelMappings,
  upsertSlackChannelMapping,
} from '@/lib/slack/agent-bot'
import { describeSlackChannel } from '@/lib/slack/destinations'
import { resolveInstalledWorkspaceBot } from '@/lib/slack/installations'
import { assertChannelMappingCreationAllowed } from '@/lib/slack/mapping-authorization'
import { requireAuth } from '@/middleware/auth'
import { resolveVerifiedTeamId } from '@/routes/agent'
import { normalizeSlackId, requireTeamAdmin, serializeMapping } from '@/routes/slack/shared'

import type { AuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

export function registerSlackMappingRoutes(slackRoutes: Hono<{ Variables: AuthVariables }>): void {
  slackRoutes.use('/mappings', requireAuth)
  slackRoutes.use('/mappings/*', requireAuth)

  slackRoutes.get('/mappings', async (c) => {
    const teamId = await resolveVerifiedTeamId(c, c.req.query('teamId'))

    if (!teamId) throw new AppError(400, 'invalid_request', 'Valid teamId is required')
    const mappings = await listSlackChannelMappings(teamId)

    // Enrich each mapping with the installation serving its workspace and live
    // channel metadata, so the settings page can show what a mapping actually
    // is: which installation, which workspace, which channel.
    const workspaceIds = [...new Set(mappings.map((mapping) => mapping.slackWorkspaceId))]
    const workspaces = new Map<
      string,
      { name: string; ownerTeamId: string; botToken: string } | null
    >()

    await Promise.all(
      workspaceIds.map(async (workspaceId) => {
        const bot = await resolveInstalledWorkspaceBot(workspaceId).catch(() => null)

        workspaces.set(
          workspaceId,
          bot
            ? { name: bot.workspaceName, ownerTeamId: bot.nuphosTeamId, botToken: bot.botToken }
            : null,
        )
      }),
    )
    const ownerTeamIds = [
      ...new Set(
        [...workspaces.values()]
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
          .map((entry) => entry.ownerTeamId)
          .filter((ownerTeamId) => ownerTeamId !== teamId),
      ),
    ]
    const ownerTeamNames = new Map(
      (await getTeamsByIds(ownerTeamIds)).map((team) => [team.id, team.name]),
    )

    const enriched = await Promise.all(
      mappings.map(async (mapping) => {
        const installation = workspaces.get(mapping.slackWorkspaceId) ?? null
        const channel = installation
          ? await describeSlackChannel(installation.botToken, mapping.slackChannelId)
          : null

        return {
          ...serializeMapping(mapping),
          workspace: {
            id: mapping.slackWorkspaceId,
            name: installation?.name ?? null,
            installed: installation !== null,
            ownedByThisTeam: installation?.ownerTeamId === teamId,
            ownerTeamName:
              installation && installation.ownerTeamId !== teamId
                ? (ownerTeamNames.get(installation.ownerTeamId) ?? null)
                : null,
          },
          channel: channel
            ? {
                name: channel.name,
                isPrivate: channel.isPrivate,
                botInChannel: channel.isMember,
                archived: channel.isArchived,
              }
            : null,
        }
      }),
    )

    return c.json({ mappings: enriched })
  })

  slackRoutes.put('/mappings', async (c) => {
    const userId = c.get('userId')
    const body = (await c.req.json()) as Record<string, unknown>
    const teamId = await resolveVerifiedTeamId(
      c,
      typeof body.teamId === 'string' ? body.teamId : undefined,
    )

    if (!teamId) throw new AppError(400, 'invalid_request', 'Valid teamId is required')
    await requireTeamAdmin(c, teamId)

    const slackWorkspaceId = normalizeSlackId(body.slackWorkspaceId, 'slackWorkspaceId')
    const slackChannelId = normalizeSlackId(body.slackChannelId, 'slackChannelId')

    // Team-side admin rights were checked above; this asserts channel-side
    // authority, since a mapping both routes the channel's messages to the team
    // and lets the team post there through the workspace's installation.
    await assertChannelMappingCreationAllowed({
      teamId,
      userId,
      slackWorkspaceId,
      slackChannelId,
    })
    const mapping = await upsertSlackChannelMapping({
      slackWorkspaceId,
      slackChannelId,
      teamId,
      createdBy: userId,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
    })

    logEvent('info', 'slack.agent.mapping.upsert', {
      user_id: userId,
      team_id: teamId,
      slack_workspace_id: slackWorkspaceId,
      slack_channel_id: slackChannelId,
    })

    return c.json({ mapping: serializeMapping(mapping) })
  })

  slackRoutes.delete('/mappings/:workspaceId/:channelId', async (c) => {
    const teamId = await resolveVerifiedTeamId(c, c.req.query('teamId'))

    if (!teamId) throw new AppError(400, 'invalid_request', 'Valid teamId is required')
    await requireTeamAdmin(c, teamId)
    const deleted = await deleteSlackChannelMapping(
      normalizeSlackId(c.req.param('workspaceId'), 'workspaceId'),
      normalizeSlackId(c.req.param('channelId'), 'channelId'),
      teamId,
    )

    return c.json({ ok: true, deleted })
  })
}
