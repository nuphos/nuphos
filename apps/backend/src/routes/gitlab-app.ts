import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import {
  evictCachedAccessToken,
  exchangeCodeForTokens,
  getCurrentUser,
  getDefaultClientCredentials,
  getSetupRedirect,
  verifyWebhookToken,
} from '@/lib/byos/gitlab'
import { decryptGitlabSecret, encryptGitlabSecret } from '@/lib/byos/secrets'
import { desktopCallbackResponse } from '@/lib/desktop-callback-page'
import { AppError } from '@/lib/errors'
import { gitlabPendingOAuth, teamByosBindings } from '@/models'

import type { GitlabBinding } from '@/models'
import type { Context } from 'hono'

export const gitlabAppRoutes = new Hono()

// The Electron deep-link target. Matches GITHUB_PROTOCOL — same scheme,
// different hostname so the desktop can route by it.
const DESKTOP_CALLBACK = 'nuphos://gitlab-callback'

const desktopCallback = (c: Context, params: Record<string, string>) =>
  desktopCallbackResponse(c, DESKTOP_CALLBACK, params)

gitlabAppRoutes.get('/setup', async (c) => {
  const state = c.req.query('state') ?? ''
  const code = c.req.query('code') ?? ''
  const errorParam = c.req.query('error')

  if (!state) {
    throw new AppError(400, 'invalid_state', 'Missing state from GitLab redirect')
  }

  if (errorParam) {
    // User declined or GitLab raised an error before issuing a code.
    await gitlabPendingOAuth().deleteOne({ _id: state })

    return desktopCallback(c, {
      state,
      error: errorParam,
      error_description: c.req.query('error_description') ?? '',
    })
  }

  if (!code) {
    throw new AppError(400, 'invalid_code', 'Missing code from GitLab redirect')
  }

  const pending = await gitlabPendingOAuth().findOneAndDelete({ _id: state })

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

  if (!redirectUri) {
    return desktopCallback(c, {
      state,
      error: 'not_configured',
      error_description: 'GITLAB_OAUTH_SETUP_REDIRECT is no longer set',
    })
  }

  let clientSecret: string | null

  if (pending.encryptedClientSecret) {
    try {
      clientSecret = decryptGitlabSecret(pending.encryptedClientSecret)
    } catch (e) {
      return desktopCallback(c, {
        state,
        error: 'decrypt_failed',
        error_description:
          e instanceof Error ? e.message : 'Failed to decrypt stored client secret',
      })
    }
  } else {
    // Default-app path — re-resolve from env so an operator rotation takes
    // effect even if the pending row was created with an older value.
    const defaults = getDefaultClientCredentials()

    if (!defaults) {
      return desktopCallback(c, {
        state,
        error: 'not_configured',
        error_description: 'GITLAB_OAUTH_CLIENT_SECRET is no longer set',
      })
    }
    clientSecret = defaults.clientSecret
  }

  let tokens

  try {
    tokens = await exchangeCodeForTokens(
      pending.hostUrl,
      pending.clientId,
      clientSecret,
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

  let user

  try {
    user = await getCurrentUser(pending.hostUrl, tokens.accessToken)
  } catch (e) {
    return desktopCallback(c, {
      state,
      error: 'user_fetch_failed',
      error_description: e instanceof Error ? e.message : 'Failed to fetch GitLab user',
    })
  }

  // Re-binding the same GitLab account (same host + user id) replaces the
  // existing binding's credentials instead of accumulating duplicates. The
  // original binding id is preserved so references stay valid.
  const existingDoc = await teamByosBindings().findOne(
    { _id: pending.teamId },
    { projection: { gitlabAccounts: 1 } },
  )
  const existing = existingDoc?.gitlabAccounts?.find(
    (a) => a.hostUrl === pending.hostUrl && a.accountId === user.id,
  )

  const bindingId = existing?.id ?? new ObjectId()
  const binding: GitlabBinding = {
    id: bindingId,
    hostUrl: pending.hostUrl,
    accountId: user.id,
    username: user.username,
    displayName: user.name,
    avatarUrl: user.avatarUrl,
    clientId: pending.clientId,
    encryptedClientSecret: pending.encryptedClientSecret,
    scope: tokens.scope,
    encryptedAccessToken: encryptGitlabSecret(tokens.accessToken),
    encryptedRefreshToken: tokens.refreshToken ? encryptGitlabSecret(tokens.refreshToken) : null,
    accessTokenExpiresAt: tokens.expiresAt,
    createdAt: existing?.createdAt ?? new Date(),
  }

  if (existing) {
    await teamByosBindings().updateOne(
      { _id: pending.teamId },
      {
        $set: { 'gitlabAccounts.$[el]': binding, updatedAt: new Date() },
      },
      { arrayFilters: [{ 'el.id': existing.id }] },
    )
    // The binding id is reused, so the superseded grant's token is still sitting
    // in the handout cache under this key — including a re-bind done purely to
    // widen scopes, which would otherwise silently keep the old scopes.
    evictCachedAccessToken(pending.teamId, existing.id)
  } else {
    await teamByosBindings().updateOne(
      { _id: pending.teamId },
      {
        $push: { gitlabAccounts: binding },
        $set: { updatedAt: new Date() },
        $setOnInsert: {
          awsRoles: [],
          gcpServiceAccounts: [],
          grafanaInstances: [],
          githubInstallations: [],
          cloudflareAccounts: [],
        },
      },
      { upsert: true },
    )
  }

  return desktopCallback(c, {
    state,
    binding_id: bindingId.toHexString(),
    team_id: pending.teamId.toHexString(),
    host_url: pending.hostUrl,
    username: user.username,
  })
})

type GitlabWebhookPayload = {
  object_kind?: string
  event_name?: string
}

gitlabAppRoutes.post('/webhook', async (c) => {
  if (!config.byos.gitlab.webhookSecret) {
    throw new AppError(503, 'webhook_not_configured', 'GITLAB_WEBHOOK_SECRET is not set')
  }

  const headerToken = c.req.header('X-Gitlab-Token')

  if (!verifyWebhookToken(headerToken)) {
    throw new AppError(401, 'invalid_signature', 'GitLab webhook token verification failed')
  }

  const rawBody = await c.req.text()
  let payload: GitlabWebhookPayload

  try {
    payload = JSON.parse(rawBody) as GitlabWebhookPayload
  } catch {
    throw new AppError(400, 'invalid_payload', 'Webhook body is not valid JSON')
  }

  const kind = payload.object_kind ?? payload.event_name ?? 'unknown'
  const delivery = c.req.header('X-Gitlab-Event-UUID') ?? '?'

  // Today we only log events; the binding lifecycle is driven by the OAuth
  // flow + explicit unbind. This handler exists so operators can wire up a
  // System Hook without us 404'ing.
  console.log(`[gitlab-webhook] ${delivery} ${kind} acknowledged`)

  return c.body(null, 204)
})
