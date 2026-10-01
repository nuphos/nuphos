import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { encryptVantaSecret } from '@/lib/byos/secrets'
import {
  getVantaOAuthClient,
  getVantaOAuthSetupRedirect,
  exchangeVantaCodeForTokens,
} from '@/lib/byos/vanta'
import { desktopCallbackResponse } from '@/lib/desktop-callback-page'
import { AppError } from '@/lib/errors'
import { vantaPendingOAuth, vantaOAuthResult, teamByosBindings } from '@/models'

import type { VantaIntegrationBinding } from '@/models'
import type { Context } from 'hono'

// Public-integration ("click to authorize") callback. SCAFFOLD: only live once
// VANTA_OAUTH_* is configured (Vanta partner approval + a registered public
// integration). The client_credentials bind path (team pastes its own client
// id/secret) does not touch this route. Mirrors cloudflare-app.ts.
export const vantaAppRoutes = new Hono()

const DESKTOP_CALLBACK = 'nuphos://vanta-callback'

const desktopCallback = (c: Context, params: Record<string, string>) =>
  desktopCallbackResponse(c, DESKTOP_CALLBACK, params)

vantaAppRoutes.get('/setup', async (c) => {
  const state = c.req.query('state') ?? ''
  const code = c.req.query('code') ?? ''
  const errorParam = c.req.query('error')

  if (!state) {
    throw new AppError(400, 'invalid_state', 'Missing state from Vanta redirect')
  }
  if (errorParam) {
    await vantaPendingOAuth().deleteOne({ _id: state })

    return desktopCallback(c, {
      state,
      error: errorParam,
      error_description: c.req.query('error_description') ?? '',
    })
  }
  if (!code) {
    throw new AppError(400, 'invalid_code', 'Missing code from Vanta redirect')
  }

  const pending = await vantaPendingOAuth().findOneAndDelete({ _id: state })

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

  const client = getVantaOAuthClient()
  const redirectUri = getVantaOAuthSetupRedirect()

  if (!client || !redirectUri) {
    return desktopCallback(c, {
      state,
      error: 'not_configured',
      error_description: 'Vanta OAuth is not configured on the server',
    })
  }

  let tokens

  try {
    tokens = await exchangeVantaCodeForTokens(
      client.clientId,
      client.clientSecret,
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

  const now = new Date()
  const binding: VantaIntegrationBinding = {
    id: new ObjectId(),
    label: 'Vanta',
    orgDisplayName: null,
    authType: 'oauth',
    oauth: {
      clientId: client.clientId,
      scope: tokens.scope,
      encryptedAccessToken: encryptVantaSecret(tokens.accessToken),
      encryptedRefreshToken: tokens.refreshToken ? encryptVantaSecret(tokens.refreshToken) : null,
      accessTokenExpiresAt: tokens.expiresAt,
    },
    createdAt: now,
  }

  await teamByosBindings().updateOne(
    { _id: pending.teamId },
    {
      $push: { vantaIntegrations: binding },
      $set: { updatedAt: now },
      $setOnInsert: {
        awsRoles: [],
        gcpServiceAccounts: [],
        grafanaInstances: [],
        githubInstallations: [],
        cloudflareAccounts: [],
        tailscaleClients: [],
        zeaburProviders: [],
      },
    },
    { upsert: true },
  )

  await vantaOAuthResult().insertOne({
    _id: state,
    teamId: pending.teamId,
    bindingId: binding.id,
    orgDisplayName: binding.orgDisplayName,
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
  })

  return desktopCallback(c, { state, ok: '1' })
})

// Desktop polling fallback (mirrors cloudflare-app /result/:state).
vantaAppRoutes.get('/result/:state', async (c) => {
  const state = c.req.param('state')
  const result = await vantaOAuthResult().findOne({ _id: state })

  if (!result) {
    throw new AppError(404, 'not_found', 'No completed Vanta OAuth result for this state')
  }

  return c.json({
    teamId: result.teamId.toHexString(),
    bindingId: result.bindingId.toHexString(),
    orgDisplayName: result.orgDisplayName,
  })
})
