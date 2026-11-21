import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { toolError, toolResult } from '@/lib/mcp/protocol'
import { requireTeamMember } from '@/middleware/auth'
import { teamWebhooksRoutes } from '@/routes/team-webhooks'

import type { ToolResult } from '@/lib/mcp/protocol'
import type { TeamAuthVariables } from '@/middleware/auth'
import type { McpCallContext } from '@/routes/mcp/types'

// Method, whether it names one webhook, and the path after it.
const ROUTES: Record<string, [string, boolean, string?]> = {
  list: ['GET', false],
  create: ['POST', false],
  update: ['PATCH', true],
  delete: ['DELETE', true],
  test: ['POST', true, '/test'],
}

/** Calls the Team settings routes themselves, for their admin gate, validation and masking. */
export async function nuphosWebhooks(
  args: Record<string, unknown>,
  ctx: McpCallContext,
): Promise<ToolResult> {
  const { action, team_id: teamId, webhook_id: webhookId, ...fields } = args
  const [method, byId, suffix = ''] = ROUTES[String(action)] ?? []

  if (!method) return toolError('action must be list, create, update, delete or test.')
  if (typeof teamId !== 'string') return toolError('team_id is required.')
  if (byId && typeof webhookId !== 'string')
    return toolError(`webhook_id is required to ${String(action)}.`)
  const app = new Hono<{ Variables: TeamAuthVariables }>()

  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('userId', ctx.userId)
    await next()
  })
  app.use('/teams/:teamId/*', requireTeamMember())
  app.route('/teams/:teamId/webhooks', teamWebhooksRoutes)
  const one = byId ? `/${encodeURIComponent(String(webhookId))}${suffix}` : ''
  const response = await app.request(`/teams/${encodeURIComponent(teamId)}/webhooks${one}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: action === 'create' || action === 'update' ? JSON.stringify(fields) : undefined,
  })
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; details?: unknown }
  }

  if (response.ok) return toolResult(body)
  const message = body.error?.message ?? `HTTP ${String(response.status)}`
  const details = body.error?.details ? ` ${JSON.stringify(body.error.details)}` : ''

  return toolError(message + details)
}
