import { Hono } from 'hono'

import { config } from '@/config'
import { routeResourceWebhook } from '@/lib/agent/resource-webhook'
import { routeGithubWebhook } from '@/lib/agent/webhook-session-router'
import { removeGithubInstallationFromAllTeams } from '@/lib/byos/account'
import { invalidateInstallationToken, verifyWebhookSignature } from '@/lib/byos/github'
import { desktopCallbackPage } from '@/lib/desktop-callback-page'
import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'

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

githubAppRoutes.get('/setup', (c) => {
  const target = config.byos.github.setupRedirect

  if (!target) {
    throw new AppError(
      503,
      'github_setup_redirect_not_configured',
      'GITHUB_APP_SETUP_REDIRECT is not configured',
    )
  }

  const installationId = c.req.query('installation_id')

  if (!installationId || !/^\d+$/.test(installationId)) {
    throw new AppError(
      400,
      'invalid_installation_id',
      'Missing or invalid installation_id from GitHub redirect',
    )
  }
  const setupAction = c.req.query('setup_action') ?? 'install'
  const state = c.req.query('state') ?? ''

  const url = normalizeSetupRedirect(target)

  url.searchParams.set('installation_id', installationId)
  url.searchParams.set('setup_action', setupAction)
  if (state) url.searchParams.set('state', state)

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return c.redirect(url.toString(), 302)
  }

  return c.html(desktopCallbackPage(url.toString()))
})

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
    logEvent('info', 'github.webhook.ignored', { delivery, event })
  }

  // Preserve installation cleanup and existing trigger routing even if resource delivery fails.
  await routeResourceWebhook(event, payload, delivery === '?' ? '' : delivery)

  return c.body(null, 204)
})
