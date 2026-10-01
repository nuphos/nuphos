import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { encryptSentrySecret } from '@/lib/byos/secrets'
import {
  exchangeCodeForTokens,
  getDefaultClientCredentials,
  getSetupRedirect,
  invalidateSentryAccessToken,
} from '@/lib/byos/sentry'
import { desktopCallbackResponse } from '@/lib/desktop-callback-page'
import { AppError } from '@/lib/errors'
import { sentryPendingOAuth, teamByosBindings } from '@/models'

import type { SentryAccountBinding } from '@/models'
import type { Context } from 'hono'

export const sentryAppRoutes = new Hono()

// The Electron deep-link target. Matches asana-callback — same scheme,
// different hostname so the desktop can route by it.
const DESKTOP_CALLBACK = 'nuphos://sentry-callback'

const desktopCallback = (c: Context, params: Record<string, string>) =>
  desktopCallbackResponse(c, DESKTOP_CALLBACK, params)

sentryAppRoutes.get('/setup', async (c) => {
  const state = c.req.query('state') ?? ''
  const code = c.req.query('code') ?? ''
  const errorParam = c.req.query('error')

  if (!state) {
    throw new AppError(400, 'invalid_state', 'Missing state from Sentry redirect')
  }

  if (errorParam) {
    await sentryPendingOAuth().deleteOne({ _id: state })

    return desktopCallback(c, {
      state,
      error: errorParam,
      error_description: c.req.query('error_description') ?? '',
    })
  }

  if (!code) {
    throw new AppError(400, 'invalid_code', 'Missing code from Sentry redirect')
  }

  const pending = await sentryPendingOAuth().findOneAndDelete({ _id: state })

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

  if (!redirectUri || !credentials) {
    return desktopCallback(c, {
      state,
      error: 'not_configured',
      error_description: 'Sentry OAuth is no longer configured on the server',
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

  const account = tokens.account

  if (!account) {
    return desktopCallback(c, {
      state,
      error: 'no_sentry_account',
      error_description: 'Sentry did not return the authorising account',
    })
  }
  const accountLabel = account.name ?? account.email ?? `Sentry user ${account.userId}`

  // Re-binding the same Sentry account replaces the existing binding's
  // credentials instead of accumulating duplicates. The original binding id is
  // preserved.
  const existingDoc = await teamByosBindings().findOne(
    { _id: pending.teamId },
    { projection: { sentryAccounts: 1 } },
  )
  const existing = (existingDoc?.sentryAccounts ?? []).find((a) => a.userId === account.userId)

  const bindingId = existing?.id ?? new ObjectId()
  const binding: SentryAccountBinding = {
    id: bindingId,
    label: existing?.label ?? accountLabel,
    userId: account.userId,
    userName: account.name,
    userEmail: account.email,
    scope: tokens.scope,
    encryptedAccessToken: encryptSentrySecret(tokens.accessToken),
    encryptedRefreshToken: tokens.refreshToken ? encryptSentrySecret(tokens.refreshToken) : null,
    accessTokenExpiresAt: tokens.expiresAt,
    createdAt: existing?.createdAt ?? new Date(),
    ...(existing?.access ? { access: existing.access } : {}),
  }

  if (existing) {
    await teamByosBindings().updateOne(
      { _id: pending.teamId },
      { $set: { 'sentryAccounts.$[el]': binding, updatedAt: new Date() } },
      { arrayFilters: [{ 'el.id': existing.id }] },
    )
    // Re-bind reuses the binding id but stores fresh tokens; drop the cached
    // access token so the next handout doesn't serve the pre-reconnect one.
    invalidateSentryAccessToken(pending.teamId, bindingId)
  } else {
    await teamByosBindings().updateOne(
      { _id: pending.teamId },
      {
        $push: { sentryAccounts: binding },
        $set: { updatedAt: new Date() },
        $setOnInsert: {
          awsRoles: [],
          gcpServiceAccounts: [],
          grafanaInstances: [],
          githubInstallations: [],
          gitlabAccounts: [],
          cloudflareAccounts: [],
          linearWorkspaces: [],
          jiraSites: [],
        },
      },
      { upsert: true },
    )
  }

  return desktopCallback(c, {
    state,
    binding_id: bindingId.toHexString(),
    team_id: pending.teamId.toHexString(),
    account_name: accountLabel,
  })
})
