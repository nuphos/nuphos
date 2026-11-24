import { decryptCustomMcpSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { OutboundBlockedError, pinnedFetch } from '@/lib/net/safe-outbound'
import { parseObjectId } from '@/lib/objectid'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import { mcpServerUrlReason, teamMcpServers } from './team-servers'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { AgentVars } from '@/routes/agent-sessions/shared'
import type { Context } from 'hono'

const PASSTHROUGH_REQUEST_HEADERS = [
  'content-type',
  'accept',
  'mcp-session-id',
  'mcp-protocol-version',
  'last-event-id',
] as const

const PASSTHROUGH_RESPONSE_HEADERS = ['content-type', 'mcp-session-id', 'cache-control'] as const

export type McpProxyFetch = typeof pinnedFetch

export type TeamMcpProxyDeps = {
  fetch?: McpProxyFetch
  getAccess?: typeof getAgentCredentialAccess
}

/**
 * Proxies one Streamable HTTP MCP request (POST / GET / DELETE) from a runtime
 * session to a team's registered remote MCP server.
 *
 * Every request is authorized against the conversation's live `mcpServerIds`
 * selection, decrypted headers are attached only on the backend, and the
 * outbound dial uses `pinnedFetch` (DNS-pinned per call, private hosts blocked
 * unless `OUTBOUND_ALLOW_PRIVATE_HOSTS` is set, and redirects refused).
 */
export function createTeamMcpProxyHandler(deps: TeamMcpProxyDeps = {}) {
  const fetchUpstream = deps.fetch ?? pinnedFetch
  const getAccess = deps.getAccess ?? getAgentCredentialAccess

  return async (c: Context<{ Variables: AgentVars & TeamAuthVariables }>) => {
    const teamId = c.get('teamId')
    const rawId = c.req.param('serverId') ?? ''
    const serverObjectId = parseObjectId(rawId, 'mcpServerId')
    const access = await getAccess(c.get('agent'), teamId)
    const selected = access.mcpServerIds.some(
      (id) => id.toLowerCase() === serverObjectId.toHexString(),
    )

    if (!selected) {
      throw new AppError(403, 'forbidden', 'MCP server is not selected for this conversation.')
    }

    const server = await teamMcpServers().findOne({ _id: serverObjectId, teamId })

    if (!server) {
      throw new AppError(404, 'mcp_server_not_found', 'MCP server not found.')
    }

    const blocked = mcpServerUrlReason(server.url)

    if (blocked) {
      throw new AppError(400, 'outbound_blocked', blocked)
    }

    const headers = new Headers()

    for (const name of PASSTHROUGH_REQUEST_HEADERS) {
      const value = c.req.header(name)

      if (value) headers.set(name, value)
    }

    try {
      for (const header of server.headers) {
        headers.set(header.name, decryptCustomMcpSecret(header.value))
      }
    } catch {
      throw new AppError(
        502,
        'mcp_headers_unavailable',
        'MCP server headers could not be decrypted. Re-enter them.',
      )
    }

    const method = c.req.method.toUpperCase()
    const body = method === 'POST' ? new Uint8Array(await c.req.arrayBuffer()) : undefined

    let upstream: Response

    try {
      upstream = await fetchUpstream(server.url, {
        method,
        headers,
        body,
        signal: c.req.raw.signal,
      })
    } catch (err) {
      if (err instanceof OutboundBlockedError) {
        throw new AppError(err.status, 'outbound_blocked', err.message)
      }
      throw new AppError(502, 'mcp_upstream_error', 'Remote MCP server request failed.')
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel().catch(() => undefined)
      throw new AppError(
        502,
        'upstream_redirect_blocked',
        'Remote MCP server returned a redirect, which is not allowed.',
      )
    }

    const responseHeaders = new Headers()

    for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name)

      if (value) responseHeaders.set(name, value)
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    })
  }
}
