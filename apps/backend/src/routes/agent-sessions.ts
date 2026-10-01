import { Hono } from 'hono'

import {
  dashboardPanelAgent,
  dashboardPanelSessionId,
  verifyDashboardPanelToken,
} from '@/lib/dashboards/panel-principal'
import { agentSubjectId, verifyAgentForActor } from '@/lib/agents/identity'
import { agentSessionClusterContexts, renderAgentKubeconfig } from '@/lib/byos/agent-kubeconfig'
import { listSelectedCredentials } from '@/lib/claude-code-preview/credential-listing'
import {
  CREDENTIALS_MCP_SURFACE,
  credentialsMcpTools,
} from '@/lib/claude-code-preview/credentials-mcp'
import { scopedPathAllowed, verifyPreviewMcpToken } from '@/lib/claude-code-preview/mcp-token'
import { nuphosToolsMcp } from '@/lib/claude-code-preview/nuphos-tools-mcp'
import { resolvePreviewToolContext } from '@/lib/claude-code-preview/preview-tool-context-resolve'
import { AppError, errorHandler, notFoundHandler } from '@/lib/errors'
import { fail, handleMcpHttpPayload } from '@/lib/mcp/protocol'
import { requireAuth, requireTeamMember } from '@/middleware/auth'
import { accountScoped } from '@/routes/agent-sessions/aws'
import { betterStackScoped } from '@/routes/agent-sessions/betterstack'
import {
  cloudflareScoped,
  hetznerScoped,
  linodeScoped,
} from '@/routes/agent-sessions/cloud-accounts'
import { cnCloudScoped } from '@/routes/agent-sessions/cn-clouds'
import { projectScoped } from '@/routes/agent-sessions/gcp'
import { asanaScoped, jiraScoped, linearScoped } from '@/routes/agent-sessions/issue-trackers'
import { previewPlans } from '@/routes/agent-sessions/plans'
import { posthogScoped } from '@/routes/agent-sessions/posthog'
import { resendScoped, sentryScoped } from '@/routes/agent-sessions/resend-sentry'
import { tailscaleScoped } from '@/routes/agent-sessions/tailscale'
import { uptimeKumaScoped } from '@/routes/agent-sessions/uptime-kuma'
import { zeaburScoped } from '@/routes/agent-sessions/zeabur'
import { fileTransfersRoutes } from '@/routes/file-transfers'
import { conversationTeamApiPathAllowed } from '@/routes/teams/conversation-api-routes'

import type { AgentRef } from '@/lib/agents/identity'
import type { McpSurface, ToolHandler } from '@/lib/mcp/protocol'
import type { AuthVariables, TeamAuthVariables } from '@/middleware/auth'
import type { AgentVars } from '@/routes/agent-sessions/shared'
import type { FileTransferVariables } from '@/routes/file-transfers'
import type { Context, MiddlewareHandler } from 'hono'

/**
 * Agent-side routes — called from inside the sandbox using NUPHOS_TOKEN. The
 * session id in the path identifies which agent is calling; we verify that
 * the authenticated user owns that session before honoring the request.
 */
export const agentSessions = new Hono<{ Variables: AgentVars }>()

// This router is also dispatched internally by the ordinary /teams API for a
// conversation principal. Give standalone dispatches the same structured
// errors as the root app instead of Hono's plain-text 500 fallback.
agentSessions.notFound(notFoundHandler)
agentSessions.onError(errorHandler)

function bearerOf(header: string | undefined): string | undefined {
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined
}

// Two accepted bearers: a normal Nuphos session token, or the scoped
// scoped MCP token the Claude Code runtime carries. Runtime endpoints are
// team-admin-configurable, so they must never see a general token — the
// scoped one is honored here and by the ordinary /teams API's explicit
// conversation-capability middleware. On this compatibility mount, the path
// must match the (session, team) it was minted for. Anything else is a hard
// 403, never a fallthrough into broader access.
const previewMcpOrSessionAuth: MiddlewareHandler<{ Variables: AuthVariables }> = async (
  c,
  next,
) => {
  const bearer = bearerOf(c.req.header('Authorization'))

  if (bearer && verifyDashboardPanelToken(bearer)) return next()
  const claims = bearer ? verifyPreviewMcpToken(bearer) : null

  if (!claims) return requireAuth(c, next)
  if (!scopedPathAllowed(c.req.path, claims)) {
    throw new AppError(403, 'forbidden', 'This token is not valid for this path')
  }
  c.set('userId', claims.sub)
  c.set('previewConversationOwnerUserId', claims.own)
  await next()
}

/** A dashboard panel token vends only the credential routes, read-only. */
const dashboardPanelSessionAuth: MiddlewareHandler<{ Variables: AgentVars }> = async (c, next) => {
  const bearer = bearerOf(c.req.header('Authorization'))
  const claims = bearer ? verifyDashboardPanelToken(bearer) : null

  if (!claims) return next()
  const match = /^(?:\/agent-sessions)?\/([^/]+)\/teams\/([^/]+)(\/.*)$/u.exec(c.req.path)
  const allowed =
    c.req.method === 'GET' &&
    match?.[1] === dashboardPanelSessionId(claims.pid) &&
    match[2] === claims.tid &&
    conversationTeamApiPathAllowed('GET', match[3] ?? '')
  const agent = allowed ? await dashboardPanelAgent(claims) : null

  if (!agent) throw new AppError(403, 'forbidden', 'This token is not valid for this path')
  c.set('userId', claims.sub)
  c.set('agent', agent)
  await next()
}

agentSessions.use('*', previewMcpOrSessionAuth)
agentSessions.use('*', dashboardPanelSessionAuth)

agentSessions.use('/:sessionId/*', async (c, next) => {
  const sessionId = c.req.param('sessionId')

  if (!sessionId) throw new AppError(400, 'invalid_request', 'Missing sessionId')
  if ((c.get('agent') as AgentRef | undefined)?.sessionId === sessionId) return next()
  const userId = c.get('userId')
  const conversationOwnerUserId = c.get('previewConversationOwnerUserId') ?? userId
  const ref = await verifyAgentForActor(userId, conversationOwnerUserId, sessionId)

  if (!ref) throw new AppError(403, 'forbidden', 'Session not found or not owned by caller')
  c.set('agent', ref)
  await next()
})

const teamScoped = new Hono<{ Variables: AgentVars & TeamAuthVariables }>()

teamScoped.use('*', requireTeamMember())

// The Claude Code OpenAB runtime's credentials MCP lists what the
// conversation has selected (live, so mid-conversation changes reflect), then
// fetches each value through the per-provider routes below — same gate, no new
// authorization surface.
teamScoped.get('/selected-credentials', async (c) => {
  const entries = await listSelectedCredentials(c.get('agent'), c.get('teamId'))

  return c.json({ credentials: entries })
})

// The same view as an MCP server (Streamable HTTP, JSON mode) — attached to
// Claude Code preview sessions via ACP `mcpServers`. get_credential dispatches
// back through this router's own vending routes with the caller's bearer, so
// every fetch re-runs the full middleware gate above.
teamScoped.post('/mcp', async (c) => {
  const agent = c.get('agent')
  const teamId = c.get('teamId')
  const authorization = c.req.header('Authorization') ?? ''
  const vend = async (credentialPath: string) => {
    const response = await agentSessions.request(
      `/${agent.sessionId}/teams/${teamId}/${credentialPath}`,
      { headers: { Authorization: authorization } },
    )

    return { status: response.status, body: await response.text() }
  }

  return serveMcp(c, credentialsMcpTools(agent, teamId, vend), CREDENTIALS_MCP_SURFACE)
})

// Nuphos's native tools (memory, dashboards, diagrams, triggers, …) as a second MCP
// server; their results render as cards through the run-frame bridge.
teamScoped.post('/mcp-tools', async (c) => {
  const agent = c.get('agent')
  const { surface, tools } = await nuphosToolsMcp(
    await resolvePreviewToolContext({
      userId: agent.userId,
      conversationOwnerUserId: agent.conversationOwnerUserId,
      teamId: c.get('teamId'),
      sessionId: agent.sessionId,
    }),
  )

  return serveMcp(c, tools, surface)
})

async function serveMcp(
  c: Context<{ Variables: AgentVars & TeamAuthVariables }>,
  tools: Record<string, ToolHandler>,
  surface: McpSurface,
) {
  let payload: unknown

  try {
    payload = await c.req.json()
  } catch {
    return c.json(fail(null, -32700, 'Parse error'), 400)
  }

  const { status, body } = await handleMcpHttpPayload(payload, tools, surface)

  if (body === null) return c.body(null, status)

  return c.json(body, status)
}

// No server->client SSE stream; JSON-response mode only.
const sseUnsupported = (c: Context) =>
  c.json(fail(null, -32000, 'SSE stream not supported; use POST.'), 405)

teamScoped.get('/mcp', sseUnsupported)
teamScoped.get('/mcp-tools', sseUnsupported)

// Script-backed native Claude Code skill. The same conversation-scoped bearer
// as the MCP mounts authenticates these REST calls; Plan itself is not an MCP.
teamScoped.route('/plans', previewPlans)

// Mount under team:
//   /agent-sessions/:sessionId/teams/:teamId/...
//     aws-accounts/:accountId/credentials
//     aws-accounts/:accountId/clusters/:name/kubeconfig
//     gcp-projects/:projectId/clusters/:name/kubeconfig
//     cloudflare-accounts/:accountId/credentials
//     linode-accounts/:accountId/credentials
//     betterstack-integrations/:integrationId/credentials
//     uptime-kuma-instances/:instanceId/monitors
//     tailscale-clients/:clientId/credentials
//     zeabur-providers/:zeaburId/credentials
teamScoped.route('/aws-accounts/:accountId', accountScoped)
teamScoped.route('/gcp-projects/:projectId', projectScoped)
teamScoped.route('/cloudflare-accounts/:accountId', cloudflareScoped)
teamScoped.route('/linode-accounts/:accountId', linodeScoped)
teamScoped.route('/hetzner-accounts/:accountId', hetznerScoped)
teamScoped.route('/', cnCloudScoped)
teamScoped.route('/betterstack-integrations/:integrationId', betterStackScoped)
teamScoped.route('/uptime-kuma-instances/:instanceId', uptimeKumaScoped)
teamScoped.route('/linear-workspaces/:bindingId', linearScoped)
teamScoped.route('/jira-sites/:bindingId', jiraScoped)
teamScoped.route('/asana-accounts/:bindingId', asanaScoped)
teamScoped.route('/resend-integrations/:integrationId', resendScoped)
teamScoped.route('/sentry-accounts/:bindingId', sentryScoped)
teamScoped.route('/posthog-integrations/:integrationId', posthogScoped)
teamScoped.route('/tailscale-clients/:clientId', tailscaleScoped)
teamScoped.route('/zeabur-providers/:zeaburId', zeaburScoped)

// Vanta and Secureframe are read-only compliance providers: the agent reads
// failing tests through the team-scoped, member-gated `/tests` proxy
// (vanta-integrations.ts / secureframe-integrations.ts). We deliberately do NOT
// expose a raw-credential endpoint to the sandbox for these — the provider
// token/secret stays server-side, matching the prompt contract. Any extra read
// surface (Vanta vulnerabilities, Secureframe controls) should get its own
// scoped proxy rather than handing the raw credential to the agent run.

// File transfer — same handlers as the Desktop team-scoped mount, but tagged
// with the calling session so groups are conversation-scoped.
const fileTransferScoped = new Hono<{ Variables: AgentVars & FileTransferVariables }>()

fileTransferScoped.use('*', async (c, next) => {
  c.set('transferSessionId', c.get('agent').sessionId)
  await next()
})
fileTransferScoped.route('/', fileTransfersRoutes)
teamScoped.route('/file-transfers', fileTransferScoped)

agentSessions.route('/:sessionId/teams/:teamId', teamScoped)

// Full-session kubeconfig: one context per cluster reachable through this
// session's selected credentials, across every provider. Credentials either
// come from the exec plugin (EKS/GKE) or are long-lived and embedded, so the
// config never expires. Fetched by sync-clusters.sh at sandbox start (and on
// demand). 204 when the session has no team or no reachable clusters, so the
// sync script leaves ~/.kube/config alone.
agentSessions.get('/:sessionId/kubeconfig', async (c) => {
  const agent = c.get('agent')
  // Membership is re-checked inside (the teamId comes from the stored session
  // row, not a middleware-gated path param, so a user removed from the team
  // must not keep enumerating its cluster inventory through an old session).
  const resolved = await agentSessionClusterContexts(agent.userId, agent.sessionId, {
    fresh: c.req.query('fresh') === '1',
    scope: c.req.query('scope') === 'onprem' ? 'onprem' : 'all',
  })

  if (!resolved || resolved.contexts.length === 0) return c.body(null, 204)

  c.header('Content-Type', 'application/yaml; charset=utf-8')
  c.header('X-Atlas-Agent', agentSubjectId(agent))

  return c.body(renderAgentKubeconfig(resolved.contexts))
})

// Lightweight identity check — handy for sandbox bootstrap scripts.
agentSessions.get('/:sessionId', (c) => {
  const agent = c.get('agent')

  return c.json({
    sessionId: agent.sessionId,
    userId: agent.userId,
    subjectId: agentSubjectId(agent),
  })
})
