import { Hono } from 'hono'

import { claimConnectorOAuth } from '@/lib/connector-oauth'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { persistAsanaBinding } from '@/routes/asana-app'
import { persistCloudflareBinding } from '@/routes/cloudflare-app'
import { persistDiscordBinding } from '@/routes/discord-app'
import { persistGitlabBinding } from '@/routes/gitlab-app'
import { persistJiraBinding } from '@/routes/jira-app'
import { persistLinearBinding } from '@/routes/linear-app'
import { persistPosthogBinding } from '@/routes/posthog-app'
import { persistSentryBinding } from '@/routes/sentry-app'
import { persistSlackBinding } from '@/routes/slack-app'

import type { ConnectorBindPersist } from '@/lib/connector-oauth'
import type { TeamAuthVariables } from '@/middleware/auth'

const PERSISTS = {
  asana: persistAsanaBinding,
  cloudflare: persistCloudflareBinding,
  discord: persistDiscordBinding,
  gitlab: persistGitlabBinding,
  jira: persistJiraBinding,
  linear: persistLinearBinding,
  posthog: persistPosthogBinding,
  sentry: persistSentryBinding,
  slack: persistSlackBinding,
} as Record<string, ConnectorBindPersist<never>>

export const connectorOAuthRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// The requester's own client finishes a grant the provider callback staged,
// proving with the callback's one-time code that the approval reached it.
connectorOAuthRoutes.post('/:state/complete', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const body = (await c.req.json().catch(() => null)) as { code?: unknown } | null

  if (typeof body?.code !== 'string' || !body.code) {
    throw new AppError(400, 'invalid_request', 'Body must include the callback code')
  }
  const ready = await claimConnectorOAuth({
    state: c.req.param('state'),
    code: body.code,
    teamId,
    userId: c.get('userId'),
  })
  const persist = PERSISTS[ready.provider]

  if (!persist) throw new AppError(404, 'oauth_not_ready', 'Unknown connector provider')

  return c.json(await persist(teamId, ready.binding as never))
})
