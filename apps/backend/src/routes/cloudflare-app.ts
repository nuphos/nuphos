import { Hono } from 'hono'

import {
  getCloudflareOAuthClient,
  getCloudflareOAuthSetupRedirect,
  exchangeCloudflareCodeForTokens,
  discoverCloudflareAccount,
} from '@/lib/byos/cloudflare-oauth'
import { encryptCloudflareApiKey } from '@/lib/byos/secrets'
import { finishConnectorOAuth } from '@/lib/connector-oauth'
import { desktopCallbackResponse } from '@/lib/desktop-callback-page'
import { AppError } from '@/lib/errors'
import { cloudflarePendingOAuth, cloudflareOAuthResult } from '@/models'
import { persistCloudflareBinding } from '@/routes/cloudflare-accounts/persist'

import type { CloudflareBindingDraft } from '@/routes/cloudflare-accounts/persist'
import type { Context } from 'hono'

export { persistCloudflareBinding }

export const cloudflareAppRoutes = new Hono()

// The Electron deep-link target. Same nuphos:// scheme as github/gitlab, with a
// distinct hostname so main.ts can route by it.
const DESKTOP_CALLBACK = 'nuphos://cloudflare-callback'

const desktopCallback = (c: Context, params: Record<string, string>) =>
  desktopCallbackResponse(c, DESKTOP_CALLBACK, params)

// Record Cloudflare's rejection for the desktop's poll too, so a deep link
// captured by another app can't leave the dialog waiting. The pending request
// stays: a replayed error must not cancel it, and a later approval replaces
// this result.
async function recordAuthorizeError(state: string, error: string, errorDescription: string) {
  const pending = await cloudflarePendingOAuth().findOne({ _id: state })

  if (!pending) return
  await cloudflareOAuthResult().replaceOne(
    { _id: state },
    {
      teamId: pending.teamId,
      error,
      errorDescription,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
    { upsert: true },
  )
}

cloudflareAppRoutes.get('/setup', async (c) => {
  const state = c.req.query('state') ?? ''
  const code = c.req.query('code') ?? ''
  const errorParam = c.req.query('error')

  if (!state) {
    throw new AppError(400, 'invalid_state', 'Missing state from Cloudflare redirect')
  }

  if (errorParam) {
    const errorDescription = c.req.query('error_description') ?? ''

    await recordAuthorizeError(state, errorParam, errorDescription)

    return desktopCallback(c, { state, error: errorParam, error_description: errorDescription })
  }

  if (!code) {
    throw new AppError(400, 'invalid_code', 'Missing code from Cloudflare redirect')
  }

  const pending = await cloudflarePendingOAuth().findOneAndDelete({ _id: state })

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

  const client = getCloudflareOAuthClient()
  const redirectUri = getCloudflareOAuthSetupRedirect()

  if (!client || !redirectUri) {
    return desktopCallback(c, {
      state,
      error: 'not_configured',
      error_description: 'Cloudflare OAuth is no longer configured on the server',
    })
  }

  let tokens

  try {
    tokens = await exchangeCloudflareCodeForTokens(
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

  let account

  try {
    account = await discoverCloudflareAccount(tokens.accessToken)
  } catch (e) {
    return desktopCallback(c, {
      state,
      error: 'account_discovery_failed',
      error_description: e instanceof Error ? e.message : 'Failed to read account for token',
    })
  }

  const draft: CloudflareBindingDraft = {
    state,
    accountId: account.accountId,
    accountName: account.accountName,
    oauth: {
      clientId: client.clientId,
      scope: tokens.scope,
      encryptedAccessToken: encryptCloudflareApiKey(tokens.accessToken),
      encryptedRefreshToken: tokens.refreshToken
        ? encryptCloudflareApiKey(tokens.refreshToken)
        : null,
      accessTokenExpiresAt: tokens.expiresAt,
    },
  }

  return desktopCallback(
    c,
    await finishConnectorOAuth({
      provider: 'cloudflare',
      state,
      teamId: pending.teamId,
      requesterUserId: pending.requesterUserId,
      share: pending.share,
      draft,
      persist: persistCloudflareBinding,
    }),
  )
})

// Desktop polling fallback: returns the bind result keyed by the unguessable
// `state` token. One-shot — the record is consumed so it can't be replayed,
// and the TTL index reaps any that are never polled. No auth (mounted on the
// public callback tree); the CSRF-grade state is the access boundary and only
// non-sensitive metadata is returned.
cloudflareAppRoutes.get('/result/:state', async (c) => {
  const state = c.req.param('state')

  if (!state) {
    throw new AppError(400, 'invalid_state', 'Missing state')
  }
  const result = await cloudflareOAuthResult().findOneAndDelete({ _id: state })

  if (!result) {
    return c.json({ ready: false })
  }
  // A rejection stays `ready: false`: desktops before the error field resolved
  // any ready result as a successful bind.
  if (!result.bindingId) {
    return c.json({ ready: false, error: result.error, errorDescription: result.errorDescription })
  }

  return c.json({
    ready: true,
    bindingId: result.bindingId.toHexString(),
    teamId: result.teamId.toHexString(),
    accountId: result.accountId,
    accountName: result.accountName,
  })
})
