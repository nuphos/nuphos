import crypto from 'node:crypto'

import { Hono } from 'hono'

import { decryptSlackSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { logEvent } from '@/lib/observability'
import { getSlackBindingForTeam, publicSlackInstallationView } from '@/lib/slack/installations'
import { deleteSlackWorkspaceMappings, revokeSlackBotAccess } from '@/lib/slack/uninstall'
import {
  buildAuthorizeUrl,
  getDefaultClientCredentials,
  getSetupRedirect,
  isSlackOAuthConfigured,
} from '@/lib/slack/oauth'
import { requireTeamRole } from '@/middleware/auth'
import { slackPendingOAuth, teamByosBindings } from '@/models'
import { registerSlackInstallationStatusRoutes } from '@/routes/slack-installations/status-channels'

import type { TeamAuthVariables } from '@/middleware/auth'

export const slackInstallationsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000

slackInstallationsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const binding = await getSlackBindingForTeam(teamId)

  return c.json({
    installation: binding ? publicSlackInstallationView(binding) : null,
    oauthAvailable: isSlackOAuthConfigured(),
  })
})

slackInstallationsRoutes.post('/start-oauth', requireTeamRole('ADMINISTRATOR'), async (c) => {
  if (!isSlackOAuthConfigured()) {
    throw new AppError(
      503,
      'slack_oauth_not_configured',
      'Slack OAuth is not configured on the server (set SLACK_OAUTH_CLIENT_ID/SECRET, SLACK_OAUTH_SETUP_REDIRECT, SLACK_TOKEN_ENCRYPTION_KEY)',
    )
  }
  const credentials = getDefaultClientCredentials()
  const setupRedirect = getSetupRedirect()

  if (!credentials || !setupRedirect) {
    throw new AppError(503, 'slack_oauth_not_configured', 'Slack OAuth is not fully configured')
  }

  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const requesterUserId = c.get('userId')
  const state = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + OAUTH_PENDING_TTL_MS)

  // On reinstall the team already has a binding. Pin Slack's authorize picker
  // to that workspace AND record it on the pending record so the setup callback
  // can reject approval of a different workspace. The `team` param only
  // pre-selects the workspace (it is not enforced by Slack), and binding a
  // different workspace would append a second slackWorkspaces entry that
  // getSlackBindingForTeam() (which reads only the first) never surfaces,
  // stranding the original install on stale scopes. Fresh installs have no
  // binding, so any workspace is accepted.
  const existingBinding = await getSlackBindingForTeam(teamId)

  await slackPendingOAuth().insertOne({
    _id: state,
    teamId,
    requesterUserId,
    ...(existingBinding ? { expectedSlackTeamId: existingBinding.slackTeamId } : {}),
    expiresAt,
  })

  const authorizeUrl = buildAuthorizeUrl({
    clientId: credentials.clientId,
    redirectUri: setupRedirect,
    state,
    team: existingBinding?.slackTeamId ?? null,
  })

  return c.json({
    authorizeUrl,
    state,
    expiresAt: expiresAt.toISOString(),
  })
})

slackInstallationsRoutes.delete(
  '/start-oauth/:state',
  requireTeamRole('ADMINISTRATOR'),
  async (c) => {
    const state = c.req.param('state')

    if (!state || !/^[a-f0-9]{1,128}$/i.test(state)) {
      throw new AppError(400, 'invalid_state', 'Invalid state token')
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')

    await slackPendingOAuth().deleteOne({ _id: state, teamId })

    return c.body(null, 204)
  },
)

slackInstallationsRoutes.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  // Revoke the bot token on Slack's side first (best-effort) so an uninstall
  // actually invalidates the credential instead of just forgetting it. Only
  // the team's own OAuth binding is revoked — never the shared legacy
  // SLACK_BOT_TOKEN fallback, which other teams may still rely on.
  const binding = await getSlackBindingForTeam(teamId)

  if (binding) {
    // Log a decrypt failure separately from a revoke API failure: a decrypt
    // error (corrupt ciphertext / rotated key) is a local key-management
    // problem, not a Slack outage, so folding both into `revoke_failed` would
    // point on-call triage the wrong way. Both are non-fatal: we still clear
    // the binding below so uninstall always completes.
    let botToken: string | null = null

    try {
      botToken = decryptSlackSecret(binding.encryptedBotToken)
    } catch (err) {
      logEvent('warn', 'slack.uninstall.token_decrypt_failed', {
        team_id: teamId.toHexString(),
        slack_team_id: binding.slackTeamId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    if (botToken) {
      await revokeSlackBotAccess(botToken, {
        onFailure: (step, err) =>
          logEvent('warn', `slack.uninstall.${step}_failed`, {
            team_id: teamId.toHexString(),
            slack_team_id: binding.slackTeamId,
            error: err instanceof Error ? err.message : String(err),
          }),
      })
    }
  }
  await teamByosBindings().updateOne(
    { _id: teamId },
    {
      $set: { slackWorkspaces: [], updatedAt: new Date() },
    },
  )
  if (binding) {
    const deleted = await deleteSlackWorkspaceMappings(teamId.toHexString(), binding.slackTeamId)

    logEvent('info', 'slack.uninstall.mappings_deleted', {
      team_id: teamId.toHexString(),
      slack_team_id: binding.slackTeamId,
      channel_mappings: deleted.channels,
      user_mappings: deleted.users,
    })
  }

  return c.body(null, 204)
})

registerSlackInstallationStatusRoutes(slackInstallationsRoutes)
