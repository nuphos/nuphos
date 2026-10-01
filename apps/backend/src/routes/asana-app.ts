import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import {
  exchangeCodeForTokens,
  getDefaultClientCredentials,
  getSetupRedirect,
  invalidateAsanaAccessToken,
} from '@/lib/byos/asana'
import { encryptAsanaSecret } from '@/lib/byos/secrets'
import { desktopCallbackResponse } from '@/lib/desktop-callback-page'
import { AppError } from '@/lib/errors'
import { asanaPendingOAuth, teamByosBindings } from '@/models'

import type { AsanaAccountBinding } from '@/models'
import type { Context } from 'hono'

export const asanaAppRoutes = new Hono()

// The Electron deep-link target. Matches jira-callback — same scheme,
// different hostname so the desktop can route by it.
const DESKTOP_CALLBACK = 'nuphos://asana-callback'

const desktopCallback = (c: Context, params: Record<string, string>) =>
  desktopCallbackResponse(c, DESKTOP_CALLBACK, params)

asanaAppRoutes.get('/setup', async (c) => {
  const state = c.req.query('state') ?? ''
  const code = c.req.query('code') ?? ''
  const errorParam = c.req.query('error')

  if (!state) {
    throw new AppError(400, 'invalid_state', 'Missing state from Asana redirect')
  }

  if (errorParam) {
    await asanaPendingOAuth().deleteOne({ _id: state })

    return desktopCallback(c, {
      state,
      error: errorParam,
      error_description: c.req.query('error_description') ?? '',
    })
  }

  if (!code) {
    throw new AppError(400, 'invalid_code', 'Missing code from Asana redirect')
  }

  const pending = await asanaPendingOAuth().findOneAndDelete({ _id: state })

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
      error_description: 'Asana OAuth is no longer configured on the server',
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
      error: 'no_asana_account',
      error_description: 'Asana did not return the authorising account',
    })
  }
  const accountLabel = account.name ?? account.email ?? `Asana user ${account.gid}`

  // Re-binding the same Asana account replaces the existing binding's
  // credentials instead of accumulating duplicates. The original binding id is
  // preserved.
  const existingDoc = await teamByosBindings().findOne(
    { _id: pending.teamId },
    { projection: { asanaAccounts: 1 } },
  )
  const existing = (existingDoc?.asanaAccounts ?? []).find((a) => a.accountGid === account.gid)

  const bindingId = existing?.id ?? new ObjectId()
  const binding: AsanaAccountBinding = {
    id: bindingId,
    label: existing?.label ?? accountLabel,
    accountGid: account.gid,
    accountName: account.name,
    accountEmail: account.email,
    scope: tokens.scope,
    encryptedAccessToken: encryptAsanaSecret(tokens.accessToken),
    encryptedRefreshToken: tokens.refreshToken ? encryptAsanaSecret(tokens.refreshToken) : null,
    accessTokenExpiresAt: tokens.expiresAt,
    createdAt: existing?.createdAt ?? new Date(),
    ...(existing?.access ? { access: existing.access } : {}),
  }

  if (existing) {
    await teamByosBindings().updateOne(
      { _id: pending.teamId },
      { $set: { 'asanaAccounts.$[el]': binding, updatedAt: new Date() } },
      { arrayFilters: [{ 'el.id': existing.id }] },
    )
    // Re-bind reuses the binding id but stores fresh tokens; drop the cached
    // access token so the next handout doesn't serve the pre-reconnect one.
    invalidateAsanaAccessToken(pending.teamId, bindingId)
  } else {
    await teamByosBindings().updateOne(
      { _id: pending.teamId },
      {
        $push: { asanaAccounts: binding },
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
