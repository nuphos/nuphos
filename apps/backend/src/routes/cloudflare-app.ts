import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import {
  getCloudflareOAuthClient,
  getCloudflareOAuthSetupRedirect,
  exchangeCloudflareCodeForTokens,
  discoverCloudflareAccount,
  invalidateCloudflareAccessToken,
} from '@/lib/byos/cloudflare-oauth'
import { appendEnvironmentBinding } from '@/lib/byos/environment-bindings'
import { encryptCloudflareApiKey } from '@/lib/byos/secrets'
import { desktopCallbackResponse } from '@/lib/desktop-callback-page'
import { AppError } from '@/lib/errors'
import { cloudflarePendingOAuth, cloudflareOAuthResult, teamByosBindings } from '@/models'

import type { CloudflareAccountBinding } from '@/models'
import type { Context } from 'hono'

export const cloudflareAppRoutes = new Hono()

// The Electron deep-link target. Same nuphos:// scheme as github/gitlab, with a
// distinct hostname so main.ts can route by it.
const DESKTOP_CALLBACK = 'nuphos://cloudflare-callback'

const desktopCallback = (c: Context, params: Record<string, string>) =>
  desktopCallbackResponse(c, DESKTOP_CALLBACK, params)

cloudflareAppRoutes.get('/setup', async (c) => {
  const state = c.req.query('state') ?? ''
  const code = c.req.query('code') ?? ''
  const errorParam = c.req.query('error')

  if (!state) {
    throw new AppError(400, 'invalid_state', 'Missing state from Cloudflare redirect')
  }

  if (errorParam) {
    await cloudflarePendingOAuth().deleteOne({ _id: state })

    return desktopCallback(c, {
      state,
      error: errorParam,
      error_description: c.req.query('error_description') ?? '',
    })
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

  // Re-binding the same account replaces its credentials (preserving the id)
  // instead of accumulating duplicates. Keyed by accountId and done with
  // conditional writes so two concurrent callbacks for the same account can't
  // both observe "no existing binding" and each $push a duplicate.
  const now = new Date()
  const oauthEnvelope = {
    clientId: client.clientId,
    scope: tokens.scope,
    encryptedAccessToken: encryptCloudflareApiKey(tokens.accessToken),
    encryptedRefreshToken: tokens.refreshToken
      ? encryptCloudflareApiKey(tokens.refreshToken)
      : null,
    accessTokenExpiresAt: tokens.expiresAt,
  }

  // Atomically replace an existing entry for this account in place. The
  // positional `$` only touches the OAuth fields, so a previously-bound
  // account's R2 S3 credentials and createdAt are preserved; $unset drops a
  // legacy API key when converting an api_token binding to OAuth.
  const rebindInPlace = () =>
    teamByosBindings().updateOne(
      { _id: pending.teamId, 'cloudflareAccounts.accountId': account.accountId },
      {
        $set: {
          'cloudflareAccounts.$.accountName': account.accountName,
          'cloudflareAccounts.$.authType': 'oauth',
          'cloudflareAccounts.$.oauth': oauthEnvelope,
          updatedAt: now,
        },
        $unset: { 'cloudflareAccounts.$.encryptedApiKey': '' },
      },
    )
  const idForAccount = async (): Promise<ObjectId> => {
    const doc = await teamByosBindings().findOne(
      { _id: pending.teamId, 'cloudflareAccounts.accountId': account.accountId },
      { projection: { 'cloudflareAccounts.$': 1 } },
    )

    return doc?.cloudflareAccounts?.[0]?.id ?? new ObjectId()
  }

  let bindingId: ObjectId

  if ((await rebindInPlace()).matchedCount > 0) {
    bindingId = await idForAccount()
  } else {
    bindingId = new ObjectId()
    const newBinding: CloudflareAccountBinding = {
      id: bindingId,
      accountId: account.accountId,
      accountName: account.accountName,
      authType: 'oauth',
      oauth: oauthEnvelope,
      createdAt: now,
    }
    const inserted = await appendEnvironmentBinding(
      pending.teamId,
      { 'cloudflareAccounts.accountId': { $ne: account.accountId } },
      { $push: { cloudflareAccounts: newBinding }, $set: { updatedAt: now } },
    )

    if (!inserted) {
      // Another flow connected the same account while OAuth was in progress.
      // Refresh that binding in place rather than consuming another slot.
      if ((await rebindInPlace()).matchedCount > 0) {
        bindingId = await idForAccount()
      } else {
        throw new AppError(
          409,
          'cloudflare_account_already_bound',
          'Cloudflare account is already bound',
        )
      }
    }
  }

  // bindingId is preserved across re-binds, and getCloudflareOAuthAccessToken
  // caches by teamId:bindingId — drop the stale entry so the new token/scopes
  // take effect immediately.
  invalidateCloudflareAccessToken(pending.teamId, bindingId)

  // Record the result keyed by `state` so the desktop can finish the bind by
  // polling even if the nuphos:// deep link below is captured by another app.
  await cloudflareOAuthResult().updateOne(
    { _id: state },
    {
      $set: {
        teamId: pending.teamId,
        bindingId,
        accountId: account.accountId,
        accountName: account.accountName,
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      },
    },
    { upsert: true },
  )

  return desktopCallback(c, {
    state,
    binding_id: bindingId.toHexString(),
    team_id: pending.teamId.toHexString(),
    account_id: account.accountId,
    account_name: account.accountName ?? '',
  })
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

  return c.json({
    ready: true,
    bindingId: result.bindingId.toHexString(),
    teamId: result.teamId.toHexString(),
    accountId: result.accountId,
    accountName: result.accountName,
  })
})
