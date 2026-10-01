import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import { logEvent } from '@/lib/observability'
import {
  deleteSlackUserMapping,
  getSlackUserMapping,
  listSlackChannelMappings,
  listSlackUserMappings,
  upsertSlackUserMapping,
} from '@/lib/slack/agent-bot'
import {
  resolveInstalledWorkspaceBot,
  resolveSlackBotForTeam,
  resolveSlackBotForWorkspace,
} from '@/lib/slack/installations'
import { resolveSlackSelfMapping } from '@/lib/slack/self-mapping'
import { fetchSlackUserName } from '@/lib/slack/user-profile'
import { requireAuth } from '@/middleware/auth'
import { resolveVerifiedTeamId } from '@/routes/agent'
import {
  normalizeNuphosUserId,
  normalizeSlackId,
  requireTeamAdmin,
  requireTeamMember,
  serializeUserMapping,
} from '@/routes/slack/shared'

import type { AuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

export function registerSlackUserMappingRoutes(
  slackRoutes: Hono<{ Variables: AuthVariables }>,
): void {
  slackRoutes.use('/user-mappings', requireAuth)
  slackRoutes.use('/user-mappings/*', requireAuth)

  slackRoutes.get('/user-mappings', async (c) => {
    const teamId = await resolveVerifiedTeamId(c, c.req.query('teamId'))

    if (!teamId) throw new AppError(400, 'invalid_request', 'Valid teamId is required')
    await requireTeamAdmin(c, teamId)
    const mappings = await listSlackUserMappings(teamId)

    const workspaceBots = new Map<string, Awaited<ReturnType<typeof resolveSlackBotForWorkspace>>>()

    for (const workspaceId of new Set(mappings.map((mapping) => mapping.slackWorkspaceId))) {
      workspaceBots.set(
        workspaceId,
        await resolveSlackBotForWorkspace(workspaceId).catch(() => null),
      )
    }
    const enriched = await Promise.all(
      mappings.map(async (mapping) => {
        const bot = workspaceBots.get(mapping.slackWorkspaceId)

        if (!bot) return { ...serializeUserMapping(mapping), slackUser: null }
        const displayName = await fetchSlackUserName(
          bot.botToken,
          mapping.slackWorkspaceId,
          mapping.slackUserId,
        )
        const matchMethod =
          mapping.createdBy === 'auto:nuphos-email' || mapping.createdBy === 'auto:slack-email'
            ? 'email'
            : bot.binding.installerSlackUserId === mapping.slackUserId
              ? 'oauth_installer'
              : 'manual'

        return {
          ...serializeUserMapping(mapping),
          slackUser: {
            id: mapping.slackUserId,
            displayName: displayName ?? mapping.slackUserId,
            matchMethod,
          },
        }
      }),
    )

    return c.json({ mappings: enriched })
  })

  slackRoutes.get('/user-mappings/me', async (c) => {
    const userId = c.get('userId')
    const teamId = await resolveVerifiedTeamId(c, c.req.query('teamId'))

    if (!teamId) throw new AppError(400, 'invalid_request', 'Valid teamId is required')
    await requireTeamMember(c, teamId)
    // Resolve against the team's own installation first, then against the
    // workspaces granting it channels — a grant-only team's members are linked
    // through the granting workspace, not an installation of their own.
    const bot = await resolveSlackBotForTeam(new ObjectId(teamId))
    const candidates: {
      slackWorkspaceId: string
      botToken: string
      installerSlackUserId: string | null
    }[] = []

    if (bot?.binding.slackTeamId) {
      candidates.push({
        slackWorkspaceId: bot.binding.slackTeamId,
        botToken: bot.botToken,
        installerSlackUserId: bot.binding.installerSlackUserId,
      })
    } else {
      const grants = (await listSlackChannelMappings(teamId)).filter((entry) => entry.enabled)

      for (const workspaceId of new Set(grants.map((entry) => entry.slackWorkspaceId))) {
        const workspaceBot = await resolveInstalledWorkspaceBot(workspaceId).catch(() => null)

        if (workspaceBot) {
          candidates.push({
            slackWorkspaceId: workspaceId,
            botToken: workspaceBot.botToken,
            installerSlackUserId: null,
          })
        }
      }
    }
    for (const candidate of candidates) {
      const mapping = await resolveSlackSelfMapping({
        botToken: candidate.botToken,
        slackWorkspaceId: candidate.slackWorkspaceId,
        teamId,
        nuphosUserId: userId,
      })

      if (!mapping) continue
      const displayName = await fetchSlackUserName(
        candidate.botToken,
        mapping.slackWorkspaceId,
        mapping.slackUserId,
      )
      const matchMethod =
        mapping.createdBy === 'auto:nuphos-email' || mapping.createdBy === 'auto:slack-email'
          ? 'email'
          : candidate.installerSlackUserId === mapping.slackUserId
            ? 'oauth_installer'
            : 'manual'

      return c.json({
        mapping: {
          ...serializeUserMapping(mapping),
          slackUser: {
            id: mapping.slackUserId,
            displayName: displayName ?? mapping.slackUserId,
            matchMethod,
          },
        },
      })
    }

    return c.json({ mapping: null })
  })

  slackRoutes.put('/user-mappings/self', async (c) => {
    const userId = c.get('userId')
    const body = (await c.req.json()) as Record<string, unknown>
    const teamId = await resolveVerifiedTeamId(
      c,
      typeof body.teamId === 'string' ? body.teamId : undefined,
    )

    if (!teamId) throw new AppError(400, 'invalid_request', 'Valid teamId is required')
    await requireTeamMember(c, teamId)

    const slackWorkspaceId = normalizeSlackId(body.slackWorkspaceId, 'slackWorkspaceId')
    const slackUserId = normalizeSlackId(body.slackUserId, 'slackUserId')
    // Prevent claiming a Slack member ID that is already linked to a different
    // Nuphos user: otherwise any member could overwrite someone else's mapping
    // and act in Slack as them.
    const existing = await getSlackUserMapping(slackWorkspaceId, teamId, slackUserId)

    if (existing && existing.nuphosUserId !== userId) {
      throw new AppError(
        409,
        'conflict',
        'This Slack member ID is already linked to another team member',
      )
    }
    const mapping = await upsertSlackUserMapping({
      slackWorkspaceId,
      slackUserId,
      teamId,
      nuphosUserId: userId,
      createdBy: userId,
      enabled: true,
    })

    logEvent('info', 'slack.agent.user_mapping.self_link', {
      user_id: userId,
      team_id: teamId,
      slack_workspace_id: slackWorkspaceId,
      slack_user_id: slackUserId,
    })

    return c.json({ mapping: serializeUserMapping(mapping) })
  })

  slackRoutes.put('/user-mappings', async (c) => {
    const userId = c.get('userId')
    const body = (await c.req.json()) as Record<string, unknown>
    const teamId = await resolveVerifiedTeamId(
      c,
      typeof body.teamId === 'string' ? body.teamId : undefined,
    )

    if (!teamId) throw new AppError(400, 'invalid_request', 'Valid teamId is required')
    await requireTeamAdmin(c, teamId)

    const slackWorkspaceId = normalizeSlackId(body.slackWorkspaceId, 'slackWorkspaceId')
    const slackUserId = normalizeSlackId(body.slackUserId, 'slackUserId')
    const nuphosUserId =
      body.nuphosUserId === undefined ? userId : normalizeNuphosUserId(body.nuphosUserId)
    const targetMembership = await getTeamMembership(nuphosUserId, teamId)

    if (!targetMembership) {
      throw new AppError(400, 'invalid_request', 'nuphosUserId must belong to the mapped team')
    }

    const mapping = await upsertSlackUserMapping({
      slackWorkspaceId,
      slackUserId,
      teamId,
      nuphosUserId,
      createdBy: userId,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
    })

    logEvent('info', 'slack.agent.user_mapping.upsert', {
      user_id: userId,
      team_id: teamId,
      slack_workspace_id: slackWorkspaceId,
      slack_user_id: slackUserId,
    })

    return c.json({ mapping: serializeUserMapping(mapping) })
  })

  slackRoutes.delete('/user-mappings/:workspaceId/:slackUserId', async (c) => {
    const teamId = await resolveVerifiedTeamId(c, c.req.query('teamId'))

    if (!teamId) throw new AppError(400, 'invalid_request', 'Valid teamId is required')
    await requireTeamAdmin(c, teamId)
    const deleted = await deleteSlackUserMapping(
      normalizeSlackId(c.req.param('workspaceId'), 'workspaceId'),
      teamId,
      normalizeSlackId(c.req.param('slackUserId'), 'slackUserId'),
    )

    return c.json({ ok: true, deleted })
  })
}
