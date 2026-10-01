import { ObjectId } from 'mongodb'

import {
  dashboardPanelAgent,
  dashboardPanelIdFromSessionId,
  verifyDashboardPanelToken,
} from '@/lib/dashboards/panel-principal'
import { verifyAgentForActor } from '@/lib/agents/identity'
import { verifyPreviewMcpToken } from '@/lib/claude-code-preview/mcp-token'
import { AppError } from '@/lib/errors'
import { requireAuth } from '@/middleware/auth'
import { agentSessions } from '@/routes/agent-sessions'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import { conversationTeamApiRoute, dashboardPanelTeamApiRoute } from './conversation-api-routes'
import {
  assertConnectorSelectionAllowed,
  selectionScopedConnectorBinding,
} from './conversation-connector-scope'
import { conversationDenialMessage } from './conversation-denial'

import type { AgentRef } from '@/lib/agents/identity'
import type { AuthVariables } from '@/middleware/auth'
import type { MiddlewareHandler } from 'hono'

export {
  conversationCanonicalTeamApiPathAllowed,
  conversationTeamApiPathAllowed,
  conversationTeamApiRoute,
  dashboardPanelTeamApiRoute,
} from './conversation-api-routes'

export type ConversationTeamAuthVariables = AuthVariables & {
  /** Present only when the bearer is the Claude runtime's scoped token. */
  conversationAgent?: AgentRef
}

function bearerToken(header: string | undefined): string | null {
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
}

function teamIdFromPath(path: string): string | null {
  return /^\/teams\/([^/]+)(?:\/|$)/u.exec(path)?.[1] ?? null
}

/**
 * Authentication for the existing /teams API. Normal user sessions retain
 * their current behavior. A Claude runtime token becomes a conversation
 * principal carrying the same user plus a mandatory team/session boundary.
 */
export const requireUserOrConversationAuth: MiddlewareHandler<{
  Variables: ConversationTeamAuthVariables
}> = async (c, next) => {
  const token = bearerToken(c.req.header('Authorization'))

  if (!token) return requireAuth(c, next)
  const panelClaims = verifyDashboardPanelToken(token)

  if (panelClaims) {
    if (teamIdFromPath(c.req.path) !== panelClaims.tid)
      throw new AppError(403, 'forbidden', 'This dashboard panel token is not valid for this team')
    const agent = await dashboardPanelAgent(panelClaims)

    if (!agent) throw new AppError(403, 'forbidden', 'This dashboard panel no longer exists')
    c.set('userId', panelClaims.sub)
    c.set('authToken', token)
    c.set('conversationAgent', agent)

    return next()
  }
  const claims = verifyPreviewMcpToken(token)

  if (!claims) return requireAuth(c, next)
  const pathTeamId = teamIdFromPath(c.req.path)

  if (pathTeamId !== claims.tid) {
    throw new AppError(403, 'forbidden', 'This conversation token is not valid for this team')
  }
  if (!ObjectId.isValid(claims.sub)) {
    throw new AppError(403, 'forbidden', 'This conversation token has an invalid user')
  }
  const agent = await verifyAgentForActor(claims.sub, claims.own, claims.sid)

  if (!agent) {
    throw new AppError(403, 'forbidden', 'Conversation not found or not owned by caller')
  }
  c.set('userId', claims.sub)
  c.set('authToken', token)
  c.set('conversationAgent', agent)
  await next()
}

const PANEL_DENIAL =
  'Dashboard panel scripts may only make GET requests for their selected credentials, connector metadata, billing usage, and dashboards.'

function teamSuffix(path: string, teamId: string): string | null {
  const prefix = `/teams/${teamId}`

  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : null
}

/**
 * Conversation principals are denied by default. Explicit provider routes
 * are dispatched to the existing selected-credential handlers, so the public
 * /teams URL and the legacy /agent-sessions URL share one authorization and
 * response implementation.
 */
export const dispatchConversationTeamApi: MiddlewareHandler<{
  Variables: ConversationTeamAuthVariables
}> = async (c, next) => {
  const agent = c.get('conversationAgent')

  if (!agent) return next()
  const teamId = c.req.param('teamId')
  const suffix = teamId ? teamSuffix(c.req.path, teamId) : null

  if (!teamId || !suffix) {
    throw new AppError(
      403,
      'conversation_api_forbidden',
      conversationDenialMessage(c.req.method, suffix),
    )
  }
  // Selection-scoped credential and proxy paths must win over the canonical
  // connector GET capability above. The agent-sessions handlers re-check the
  // conversation's live selection on every request.
  const panel = dashboardPanelIdFromSessionId(agent.sessionId) !== null
  const route = panel
    ? dashboardPanelTeamApiRoute(c.req.method, suffix)
    : conversationTeamApiRoute(c.req.method, suffix)

  if (!route) {
    throw new AppError(
      403,
      'conversation_api_forbidden',
      panel ? PANEL_DENIAL : conversationDenialMessage(c.req.method, suffix),
    )
  }
  const scoped = selectionScopedConnectorBinding(suffix)

  if (scoped) {
    // Read live on every request so a mid-conversation deselection revokes at once.
    assertConnectorSelectionAllowed(await getAgentCredentialAccess(agent, teamId), scoped)
  }

  if (route === 'canonical') return next()
  const source = new URL(c.req.url)

  source.pathname = `/${agent.sessionId}/teams/${teamId}${suffix}`
  const method = c.req.method.toUpperCase()
  const body =
    method === 'GET' || method === 'HEAD' ? undefined : await c.req.raw.clone().arrayBuffer()
  const request = new Request(source.toString(), {
    method,
    headers: Object.fromEntries(c.req.raw.headers.entries()),
    body,
    signal: c.req.raw.signal,
  })

  return agentSessions.fetch(request)
}
