import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import {
  exchangeCodeForTokens,
  getAccessibleResources,
  getDefaultClientCredentials,
  getSetupRedirect,
  invalidateAccessToken,
} from '@/lib/byos/jira'
import { encryptJiraSecret } from '@/lib/byos/secrets'
import { desktopCallbackResponse } from '@/lib/desktop-callback-page'
import { AppError } from '@/lib/errors'
import { jiraPendingOAuth, teamByosBindings } from '@/models'

import type { JiraSiteBinding } from '@/models'
import type { Context } from 'hono'

export const jiraAppRoutes = new Hono()

// The Electron deep-link target. Matches linear-callback — same scheme,
// different hostname so the desktop can route by it.
const DESKTOP_CALLBACK = 'nuphos://jira-callback'

const desktopCallback = (c: Context, params: Record<string, string>) =>
  desktopCallbackResponse(c, DESKTOP_CALLBACK, params)

jiraAppRoutes.get('/setup', async (c) => {
  const state = c.req.query('state') ?? ''
  const code = c.req.query('code') ?? ''
  const errorParam = c.req.query('error')

  if (!state) {
    throw new AppError(400, 'invalid_state', 'Missing state from Atlassian redirect')
  }

  if (errorParam) {
    await jiraPendingOAuth().deleteOne({ _id: state })

    return desktopCallback(c, {
      state,
      error: errorParam,
      error_description: c.req.query('error_description') ?? '',
    })
  }

  if (!code) {
    throw new AppError(400, 'invalid_code', 'Missing code from Atlassian redirect')
  }

  const pending = await jiraPendingOAuth().findOneAndDelete({ _id: state })

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
      error_description: 'Jira OAuth is no longer configured on the server',
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

  // Resolve the Atlassian site(s) this grant can reach. cloudId is required to
  // build the Jira REST base URL.
  let sites

  try {
    sites = await getAccessibleResources(tokens.accessToken)
  } catch (e) {
    return desktopCallback(c, {
      state,
      error: 'resource_fetch_failed',
      error_description: e instanceof Error ? e.message : 'Failed to fetch Jira sites',
    })
  }
  const site = sites[0]

  if (!site) {
    return desktopCallback(c, {
      state,
      error: 'no_jira_site',
      error_description: 'The Atlassian grant has no accessible Jira sites',
    })
  }
  // Fail closed rather than silently binding sites[0] when the grant spans
  // multiple sites — picking arbitrarily could bind the wrong tenant and let
  // the agent read/write the unintended site. A per-site picker is a follow-up;
  // until then the user narrows the grant on Atlassian's consent screen.
  if (sites.length > 1) {
    return desktopCallback(c, {
      state,
      error: 'multiple_jira_sites',
      // Don't put tenant site URLs in the custom-scheme callback (it can be
      // persisted by browser/OS deep-link logs); the count is enough.
      error_description: `This Atlassian grant spans ${String(sites.length)} Jira sites. Re-authorize and grant access to a single site.`,
    })
  }

  // Re-binding the same site replaces the existing binding's credentials
  // instead of accumulating duplicates. The original binding id is preserved.
  const existingDoc = await teamByosBindings().findOne(
    { _id: pending.teamId },
    { projection: { jiraSites: 1 } },
  )
  const existing = existingDoc?.jiraSites?.find((s) => s.cloudId === site.id)

  const bindingId = existing?.id ?? new ObjectId()
  const binding: JiraSiteBinding = {
    id: bindingId,
    label: existing?.label ?? site.name,
    cloudId: site.id,
    siteName: site.name,
    siteUrl: site.url,
    accountId: pending.requesterUserId,
    accountName: null,
    scope: tokens.scope,
    encryptedAccessToken: encryptJiraSecret(tokens.accessToken),
    encryptedRefreshToken: tokens.refreshToken ? encryptJiraSecret(tokens.refreshToken) : null,
    accessTokenExpiresAt: tokens.expiresAt,
    createdAt: existing?.createdAt ?? new Date(),
    ...(existing?.access ? { access: existing.access } : {}),
  }

  if (existing) {
    await teamByosBindings().updateOne(
      { _id: pending.teamId },
      { $set: { 'jiraSites.$[el]': binding, updatedAt: new Date() } },
      { arrayFilters: [{ 'el.id': existing.id }] },
    )
    // The binding id is reused, so the superseded grant's token is still sitting
    // in the handout cache under this key.
    invalidateAccessToken(pending.teamId, existing.id)
  } else {
    await teamByosBindings().updateOne(
      { _id: pending.teamId },
      {
        $push: { jiraSites: binding },
        $set: { updatedAt: new Date() },
        $setOnInsert: {
          awsRoles: [],
          gcpServiceAccounts: [],
          grafanaInstances: [],
          githubInstallations: [],
          gitlabAccounts: [],
          cloudflareAccounts: [],
          linearWorkspaces: [],
        },
      },
      { upsert: true },
    )
  }

  return desktopCallback(c, {
    state,
    binding_id: bindingId.toHexString(),
    team_id: pending.teamId.toHexString(),
    site_name: site.name,
  })
})
