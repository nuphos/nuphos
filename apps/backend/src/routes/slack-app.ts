import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { encryptSlackSecret } from '@/lib/byos/secrets'
import { desktopCallbackResponse } from '@/lib/desktop-callback-page'
import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'
import { assertSlackWorkspaceAvailable, getSlackBindingForTeam } from '@/lib/slack/installations'
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  getDefaultClientCredentials,
  getSetupRedirect,
  isSlackOAuthConfigured,
} from '@/lib/slack/oauth'
import { autoLinkInstaller, sendSlackInstallWelcomeDm } from '@/lib/slack/onboarding'
import { slackPendingOAuth, teamByosBindings } from '@/models'

import type { SlackWorkspaceBinding } from '@/models'
import type { Context } from 'hono'

export const slackAppRoutes = new Hono()

const DESKTOP_CALLBACK = 'nuphos://slack-callback'

const desktopCallback = (c: Context, params: Record<string, string>) =>
  desktopCallbackResponse(c, DESKTOP_CALLBACK, params)

slackAppRoutes.get('/setup', async (c) => {
  const state = c.req.query('state') ?? ''
  const code = c.req.query('code') ?? ''
  const errorParam = c.req.query('error')

  if (!state) {
    throw new AppError(400, 'invalid_state', 'Missing state from Slack redirect')
  }

  if (errorParam) {
    await slackPendingOAuth().deleteOne({ _id: state })

    return desktopCallback(c, {
      state,
      error: errorParam,
      error_description: c.req.query('error_description') ?? '',
    })
  }

  if (!code) {
    throw new AppError(400, 'invalid_code', 'Missing code from Slack redirect')
  }

  const pending = await slackPendingOAuth().findOneAndDelete({ _id: state })

  if (!pending) {
    return desktopCallback(c, {
      state,
      error: 'unknown_state',
      error_description: 'OAuth state did not match a pending request (expired or already used)',
    })
  }
  if (pending.expiresAt.getTime() < Date.now()) {
    return desktopCallback(c, {
      state,
      error: 'expired',
      error_description: 'OAuth request expired before approval',
    })
  }

  const redirectUri = getSetupRedirect()
  const credentials = getDefaultClientCredentials()

  // isSlackOAuthConfigured also requires the token encryption key — without it
  // the callback below would fail at encryptSlackSecret, stranding the user
  // with an unhandled error instead of a desktop redirect.
  if (!redirectUri || !credentials || !isSlackOAuthConfigured()) {
    return desktopCallback(c, {
      state,
      error: 'not_configured',
      error_description: 'Slack OAuth is no longer fully configured on the server',
    })
  }

  let tokens

  try {
    tokens = await exchangeCodeForTokens(
      credentials.clientId,
      credentials.clientSecret,
      code,
      redirectUri,
    )
  } catch (e) {
    return desktopCallback(c, {
      state,
      error: 'exchange_failed',
      error_description: e instanceof Error ? e.message : 'Token exchange failed',
    })
  }

  // Reinstall integrity: a reinstall started against an already-bound workspace
  // must land on that same workspace. Slack's `team` authorize param only
  // pre-selects (does not enforce) the workspace, so an admin could approve a
  // different one; binding it would append a second slackWorkspaces entry the
  // team read path (getSlackBindingForTeam -> slackWorkspaces[0]) never
  // surfaces, silently leaving the original install on stale scopes.
  if (pending.expectedSlackTeamId && pending.expectedSlackTeamId !== tokens.slackTeamId) {
    logEvent('warn', 'slack.reinstall.workspace_mismatch', {
      team_id: pending.teamId.toHexString(),
      expected_slack_team_id: pending.expectedSlackTeamId,
      approved_slack_team_id: tokens.slackTeamId,
    })

    return desktopCallback(c, {
      state,
      error: 'workspace_mismatch',
      error_description:
        'You approved a different Slack workspace than the one being reinstalled. Start over and approve the same workspace.',
    })
  }

  try {
    await assertSlackWorkspaceAvailable(tokens.slackTeamId, pending.teamId)
  } catch (e) {
    return desktopCallback(c, {
      state,
      error: 'workspace_taken',
      error_description: e instanceof AppError ? e.message : 'Slack workspace already connected',
    })
  }

  const existingDoc = await teamByosBindings().findOne(
    { _id: pending.teamId },
    { projection: { slackWorkspaces: 1 } },
  )
  const existing = existingDoc?.slackWorkspaces?.find(
    (entry) => entry.slackTeamId === tokens.slackTeamId,
  )

  const bindingId = existing?.id ?? new ObjectId()
  const binding: SlackWorkspaceBinding = {
    id: bindingId,
    slackTeamId: tokens.slackTeamId,
    slackTeamName: tokens.slackTeamName,
    botUserId: tokens.botUserId,
    encryptedBotToken: encryptSlackSecret(tokens.botToken),
    installerSlackUserId: tokens.installerSlackUserId,
    scope: tokens.scope,
    createdAt: existing?.createdAt ?? new Date(),
  }

  try {
    if (existing) {
      await teamByosBindings().updateOne(
        { _id: pending.teamId },
        {
          $set: { 'slackWorkspaces.$[el]': binding, updatedAt: new Date() },
        },
        { arrayFilters: [{ 'el.id': existing.id }] },
      )
    } else {
      await teamByosBindings().updateOne(
        { _id: pending.teamId },
        {
          $push: { slackWorkspaces: binding },
          $set: { updatedAt: new Date() },
          $setOnInsert: {
            awsRoles: [],
            gcpServiceAccounts: [],
            grafanaInstances: [],
            githubInstallations: [],
            gitlabAccounts: [],
            cloudflareAccounts: [],
            linodeAccounts: [],
            betterStackIntegrations: [],
            tailscaleClients: [],
            zeaburProviders: [],
            linearWorkspaces: [],
          },
        },
        { upsert: true },
      )
    }
  } catch (e) {
    // The unique index on slackWorkspaces.slackTeamId is the authoritative
    // guard against the same workspace being claimed by two teams racing
    // through OAuth at once; assertSlackWorkspaceAvailable above only catches
    // the non-concurrent case.
    if (e instanceof Error && 'code' in e && (e as { code?: number }).code === 11000) {
      return desktopCallback(c, {
        state,
        error: 'workspace_taken',
        error_description: 'This Slack workspace is already connected to another Nuphos team',
      })
    }
    throw e
  }

  await autoLinkInstaller({
    slackWorkspaceId: tokens.slackTeamId,
    teamId: pending.teamId.toHexString(),
    installerSlackUserId: tokens.installerSlackUserId,
    requesterNuphosUserId: pending.requesterUserId,
  })

  // Only DM the installer on a fresh install. Reinstall reuses this callback
  // to refresh scopes/token in place (`existing` is set), and re-sending the
  // onboarding DM every time an admin re-approves would be noise.
  if (!existing && tokens.installerSlackUserId) {
    try {
      await sendSlackInstallWelcomeDm({
        botToken: tokens.botToken,
        installerSlackUserId: tokens.installerSlackUserId,
        slackTeamName: tokens.slackTeamName,
      })
    } catch (err) {
      logEvent('warn', 'slack.install.welcome_dm_failed', {
        team_id: pending.teamId.toHexString(),
        slack_team_id: tokens.slackTeamId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  logEvent('info', 'slack.install.completed', {
    team_id: pending.teamId.toHexString(),
    slack_team_id: tokens.slackTeamId,
    requester_user_id: pending.requesterUserId,
  })

  return desktopCallback(c, {
    state,
    binding_id: bindingId.toHexString(),
    team_id: pending.teamId.toHexString(),
    slack_team_name: tokens.slackTeamName,
  })
})

// Health check for Slack app configuration (no auth).
slackAppRoutes.get('/configured', (c) => {
  return c.json({
    oauthConfigured: isSlackOAuthConfigured(),
    signingSecretConfigured: Boolean(config.slack.signingSecret),
  })
})

export async function getTeamSlackInstallation(teamId: ObjectId) {
  return await getSlackBindingForTeam(teamId)
}
