import { createHash } from 'node:crypto'

import { Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { recordPullMerge, routeResourceWebhook } from '@/lib/agent/resource-webhook'
import { routeGithubWebhook } from '@/lib/agent/webhook-session-router'
import { removeGithubInstallationFromAllTeams } from '@/lib/byos/account'
import {
  buildInstallUrl,
  getInstallation,
  invalidateInstallationToken,
  verifyWebhookSignature,
} from '@/lib/byos/github'
import {
  administeredTeamName,
  bindGithubInstallation,
  encodeInstallFlowState,
  githubSetupUrl,
  browserFlowState,
  INSTALL_FLOW_COOKIE,
  installFlowVerifier,
  invalidFlow,
  signInstallFlowState,
  verifyInstallFlowState,
} from '@/lib/byos/github-install-flow'
import { desktopCallbackPage, githubInstallConfirmPage } from '@/lib/desktop-callback-page'
import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'
import {
  exchangeGithubCode,
  githubAuthorizeUrl,
  githubOAuthClient,
  githubUserInstallationIds,
  revokeGithubToken,
} from '@/lib/personal-credentials/github'

import type { InstallFlowState } from '@/lib/byos/github-install-flow'
import type { Context } from 'hono'

export const githubAppRoutes = new Hono()

function normalizeSetupRedirect(target: string): URL {
  let url: URL

  try {
    url = new URL(target)
  } catch {
    throw new AppError(
      503,
      'invalid_setup_redirect',
      'GITHUB_APP_SETUP_REDIRECT must be a valid absolute URL',
    )
  }
  if (url.protocol === 'zeabur-atlas:') url.protocol = 'nuphos:'

  return url
}

// Opened by the client with the ticket from GET .../install-url. Clients append
// their own correlation `state`, which GitHub cannot carry next to ours, so it
// travels inside the signed state and is handed back at the end.
githubAppRoutes.get('/install', (c) => {
  const ticket = verifyInstallFlowState(c.req.query('ticket'))

  if (!ticket) invalidFlow()
  const clientState = c.req.query('state') ?? ticket.s
  const state = signInstallFlowState({
    t: ticket.t,
    u: ticket.u,
    ...(clientState ? { s: clientState } : {}),
  })
  const url = buildInstallUrl(state)

  if (!url) throw new AppError(503, 'github_app_not_configured', 'GITHUB_APP_SLUG is not set')
  setCookie(c, INSTALL_FLOW_COOKIE, verifyInstallFlowState(state)?.n ?? '', {
    path: '/github-app',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 600,
  })

  return c.redirect(url, 302)
})

// Both GitHub legs return here: first from the installation (installation_id),
// then from the user authorization (code), which leads to the confirm page.
githubAppRoutes.get('/setup', async (c) => {
  const state = browserFlowState(c, c.req.query('state'))
  const code = c.req.query('code')
  const client = githubOAuthClient()
  const redirectUri = githubSetupUrl()

  if (!client || !redirectUri) {
    throw new AppError(
      503,
      'github_oauth_not_configured',
      'GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET and NUPHOS_PUBLIC_BACKEND_URL are required',
    )
  }

  if (!code) {
    // Only a fresh state from /install may pick the installation.
    if (state.i !== undefined || state.v) invalidFlow()
    const installationId = c.req.query('installation_id')

    if (!installationId || !/^\d+$/.test(installationId)) {
      throw new AppError(
        400,
        'invalid_installation_id',
        'Missing or invalid installation_id from GitHub redirect',
      )
    }
    const next = {
      ...state,
      i: Number(installationId),
      a: c.req.query('setup_action') ?? 'install',
    }

    return c.redirect(
      githubAuthorizeUrl({
        clientId: client.clientId,
        redirectUri,
        state: encodeInstallFlowState(next),
        codeChallenge: createHash('sha256').update(installFlowVerifier(next)).digest('base64url'),
      }),
      302,
    )
  }

  const installationId = state.i

  if (!installationId || state.v) invalidFlow()
  const accessToken = (
    await exchangeGithubCode({
      ...client,
      code,
      redirectUri,
      codeVerifier: installFlowVerifier(state),
    }).catch(() => invalidFlow())
  ).accessToken

  try {
    if (!(await githubUserInstallationIds(accessToken)).includes(installationId)) {
      logEvent('warn', 'github.install.ownership_rejected', {
        team_id: state.t,
        user_id: state.u,
        installation_id: installationId,
      })

      return returnToClient(c, state)
    }
  } finally {
    await revokeGithubToken(accessToken).catch(() => null)
  }
  const teamName = await administeredTeamName(state.u, state.t)

  if (!teamName) return returnToClient(c, state)
  c.header('Content-Security-Policy', "frame-ancestors 'none'")

  return c.html(
    githubInstallConfirmPage({
      accountLogin: (await getInstallation(installationId)).account.login,
      teamName,
      action: redirectUri.replace(/\/setup$/u, '/confirm'),
      state: encodeInstallFlowState({ ...state, v: 1 }),
    }),
  )
})

// The person who proved access confirms the destination team; only then bind.
githubAppRoutes.post('/confirm', async (c) => {
  const form = await c.req.parseBody()
  const state = browserFlowState(c, typeof form.state === 'string' ? form.state : undefined)

  if (!state.v || !state.i) invalidFlow()
  if (await administeredTeamName(state.u, state.t)) {
    await bindGithubInstallation(new ObjectId(state.t), state.i)
  }
  deleteCookie(c, INSTALL_FLOW_COOKIE, { path: '/github-app', secure: true })

  return returnToClient(c, state)
})

function returnToClient(c: Context, state: InstallFlowState) {
  const target = config.byos.github.setupRedirect

  if (!target) {
    throw new AppError(
      503,
      'github_setup_redirect_not_configured',
      'GITHUB_APP_SETUP_REDIRECT is not configured',
    )
  }
  const url = normalizeSetupRedirect(target)

  url.searchParams.set('installation_id', String(state.i))
  url.searchParams.set('setup_action', state.a ?? 'install')
  if (state.s) url.searchParams.set('state', state.s)

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return c.redirect(url.toString(), 302)
  }

  return c.html(desktopCallbackPage(url.toString()))
}

type InstallationEvent = {
  action?: string
  installation?: { id?: number; account?: { login?: string } | null }
}

githubAppRoutes.post('/webhook', async (c) => {
  if (!config.byos.github.webhookSecret) {
    throw new AppError(503, 'webhook_not_configured', 'GITHUB_APP_WEBHOOK_SECRET is not set')
  }

  const rawBody = new Uint8Array(await c.req.raw.arrayBuffer())
  const sig = c.req.header('X-Hub-Signature-256')

  if (!verifyWebhookSignature(rawBody, sig)) {
    throw new AppError(401, 'invalid_signature', 'Webhook signature verification failed')
  }

  const event = c.req.header('X-GitHub-Event') ?? 'unknown'
  const delivery = c.req.header('X-GitHub-Delivery') ?? '?'

  let payload: InstallationEvent

  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody))
  } catch {
    throw new AppError(400, 'invalid_payload', 'Webhook body is not valid JSON')
  }

  if (event === 'installation') {
    const installationId = payload.installation?.id
    const action = payload.action

    if (typeof installationId === 'number') {
      if (action === 'deleted') {
        const removed = await removeGithubInstallationFromAllTeams(installationId)

        invalidateInstallationToken(installationId)
        logEvent('info', 'github.webhook.installation_deleted', {
          delivery,
          installation_id: installationId,
          unbound_teams: removed,
        })
      } else if (action === 'suspend' || action === 'unsuspend') {
        invalidateInstallationToken(installationId)
        logEvent('info', 'github.webhook.installation_token_invalidated', {
          delivery,
          action,
          installation_id: installationId,
        })
      } else {
        logEvent('info', 'github.webhook.installation_ignored', {
          delivery,
          action: action ?? 'unknown',
          installation_id: installationId,
        })
      }
    }
  } else if (event === 'installation_repositories') {
    const installationId = payload.installation?.id

    if (typeof installationId === 'number') {
      logEvent('info', 'github.webhook.installation_repositories_ignored', {
        delivery,
        action: payload.action ?? 'unknown',
        installation_id: installationId,
      })
    }
  } else if (event === 'pull_request') {
    await routeGithubWebhook(event, payload, delivery === '?' ? '' : delivery)
  } else if (event === 'ping') {
    logEvent('info', 'github.webhook.ping', { delivery })
  } else {
    logEvent('info', 'github.webhook.ignored', { delivery, github_event: event })
  }

  // Linked PRs keep their merge time, for the sidebar's PRs merged this month.
  await recordPullMerge(event, payload)
  // Preserve installation cleanup and existing trigger routing even if resource delivery fails.
  await routeResourceWebhook(event, payload, delivery === '?' ? '' : delivery)

  return c.body(null, 204)
})
