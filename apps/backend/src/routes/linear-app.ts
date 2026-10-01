import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import {
  exchangeCodeForTokens,
  getDefaultClientCredentials,
  getSetupRedirect,
  getViewer,
  invalidateAccessToken,
  verifyWebhookSignature,
} from '@/lib/byos/linear'
import { encryptLinearSecret } from '@/lib/byos/secrets'
import { desktopCallbackResponse } from '@/lib/desktop-callback-page'
import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'
import { linearPendingOAuth, teamByosBindings } from '@/models'

import type { LinearWorkspaceBinding } from '@/models'
import type { Context } from 'hono'

export const linearAppRoutes = new Hono()

// The Electron deep-link target. Matches GITHUB_PROTOCOL / gitlab-callback —
// same scheme, different hostname so the desktop can route by it.
const DESKTOP_CALLBACK = 'nuphos://linear-callback'

const desktopCallback = (c: Context, params: Record<string, string>) =>
  desktopCallbackResponse(c, DESKTOP_CALLBACK, params)

linearAppRoutes.get('/setup', async (c) => {
  const state = c.req.query('state') ?? ''
  const code = c.req.query('code') ?? ''
  const errorParam = c.req.query('error')

  if (!state) {
    throw new AppError(400, 'invalid_state', 'Missing state from Linear redirect')
  }

  if (errorParam) {
    // User declined or Linear raised an error before issuing a code.
    await linearPendingOAuth().deleteOne({ _id: state })

    return desktopCallback(c, {
      state,
      error: errorParam,
      error_description: c.req.query('error_description') ?? '',
    })
  }

  if (!code) {
    throw new AppError(400, 'invalid_code', 'Missing code from Linear redirect')
  }

  const pending = await linearPendingOAuth().findOneAndDelete({ _id: state })

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
      error_description: 'Linear OAuth is no longer configured on the server',
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

  let viewer

  try {
    viewer = await getViewer(tokens.accessToken)
  } catch (e) {
    return desktopCallback(c, {
      state,
      error: 'viewer_fetch_failed',
      error_description: e instanceof Error ? e.message : 'Failed to fetch Linear workspace',
    })
  }

  // Re-binding the same workspace replaces the existing binding's credentials
  // instead of accumulating duplicates. The original binding id is preserved so
  // references stay valid.
  const existingDoc = await teamByosBindings().findOne(
    { _id: pending.teamId },
    { projection: { linearWorkspaces: 1 } },
  )
  const existing = existingDoc?.linearWorkspaces?.find(
    (w) => w.workspaceId === viewer.organization.id,
  )

  const bindingId = existing?.id ?? new ObjectId()
  const binding: LinearWorkspaceBinding = {
    id: bindingId,
    label: existing?.label ?? viewer.organization.name,
    workspaceId: viewer.organization.id,
    workspaceName: viewer.organization.name,
    organizationUrlKey: viewer.organization.urlKey,
    accountId: viewer.user.id,
    accountName: viewer.user.name,
    scope: tokens.scope,
    encryptedAccessToken: encryptLinearSecret(tokens.accessToken),
    encryptedRefreshToken: tokens.refreshToken ? encryptLinearSecret(tokens.refreshToken) : null,
    accessTokenExpiresAt: tokens.expiresAt,
    createdAt: existing?.createdAt ?? new Date(),
    ...(existing?.access ? { access: existing.access } : {}),
  }

  if (existing) {
    await teamByosBindings().updateOne(
      { _id: pending.teamId },
      {
        $set: { 'linearWorkspaces.$[el]': binding, updatedAt: new Date() },
      },
      { arrayFilters: [{ 'el.id': existing.id }] },
    )
    // The binding id is reused, so the superseded grant's token is still sitting
    // in the handout cache under this key.
    invalidateAccessToken(pending.teamId, existing.id)
  } else {
    await teamByosBindings().updateOne(
      { _id: pending.teamId },
      {
        $push: { linearWorkspaces: binding },
        $set: { updatedAt: new Date() },
        $setOnInsert: {
          awsRoles: [],
          gcpServiceAccounts: [],
          grafanaInstances: [],
          githubInstallations: [],
          gitlabAccounts: [],
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
    workspace_name: viewer.organization.name,
  })
})

type LinearWebhookPayload = {
  type?: string
  action?: string
}

// Reverse-sync (Linear → agent) is intentionally NOT implemented yet — the
// closed loop is human-chat-driven for now. This handler verifies the signature
// and acknowledges so the webhook can be wired up in the Linear app ahead of
// that work (mirrors the GitLab /gitlab-app/webhook ack stub). When reverse-sync
// lands, dispatch off `payload.type`/`payload.action` here.
linearAppRoutes.post('/webhook', async (c) => {
  if (!config.byos.linear.webhookSecret) {
    throw new AppError(503, 'webhook_not_configured', 'LINEAR_WEBHOOK_SECRET is not set')
  }

  const rawBody = new Uint8Array(await c.req.raw.arrayBuffer())
  const sig = c.req.header('Linear-Signature')

  if (!verifyWebhookSignature(rawBody, sig)) {
    throw new AppError(401, 'invalid_signature', 'Linear webhook signature verification failed')
  }

  let payload: LinearWebhookPayload

  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody)) as LinearWebhookPayload
  } catch {
    throw new AppError(400, 'invalid_payload', 'Webhook body is not valid JSON')
  }

  logEvent('info', 'linear.webhook.acknowledged', {
    type: payload.type ?? 'unknown',
    action: payload.action ?? 'unknown',
  })

  return c.body(null, 200)
})
