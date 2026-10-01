// MCP (Model Context Protocol) server for the Nuphos Agent.
//
// Exposes the Nuphos Agent to external MCP clients — Claude Code, Codex, and any
// other MCP-capable agent — so a developer's coding assistant can talk to the
// Nuphos Agent directly. Both Claude Code and Codex are native MCP clients, so
// an MCP server is the zero-glue integration surface (no custom CLI or A2A
// bridge required on the caller's side).
//
// Transport: MCP Streamable HTTP, JSON-response mode. We speak JSON-RPC 2.0 over
// a single `POST /mcp` endpoint and reply with `application/json`. We do NOT
// open a server->client SSE stream (`GET /mcp` is unsupported), because the
// long-running-task story is handled at the data layer, not the transport:
//   - `nuphos_ask` starts an agent run and blocks until it finishes. The run is
//     created via `runAgentForTrigger`, which drives its own AbortController
//     independent of this HTTP request — so if the caller's tool-call times out
//     and the connection drops, the agent keeps running to completion and the
//     transcript is persisted.
//   - `nuphos_check` reconnects to a session by id and returns the answer if the
//     run has finished, or "running" if it's still going. This is how a caller
//     recovers a result after a timeout — no separate "task" concept is exposed;
//     the session id is the only handle.
//
// The pure JSON-RPC/protocol layer lives in lib/mcp/protocol.ts; the
// agent-touching tool implementations live in routes/mcp/*.

import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { authenticateToken } from '@/lib/identity'
import { fail, handleMcpHttpPayload } from '@/lib/mcp/protocol'
import { mcpResourceUrl } from '@/lib/oauth/metadata'
import { getClient } from '@/lib/oauth/store'
import { verifyAccessToken } from '@/lib/oauth/tokens'
import { toolsForContext } from '@/routes/mcp/tools'

import type { AgentClientMeta } from '@/lib/agent/db'
import type { AuthVariables } from '@/middleware/auth'
import type { MiddlewareHandler } from 'hono'

// ─── HTTP route ─────────────────────────────────────────────────────────────

type McpVariables = AuthVariables & { mcpOauthClientId: string | undefined }

export const mcp = new Hono<{ Variables: McpVariables }>()

// MCP resource-server auth. On a missing/invalid token we emit the RFC 9728
// `WWW-Authenticate` challenge pointing at our Protected Resource Metadata, so
// MCP clients (Claude Code, Codex) can discover the authorization server and
// run the native browser OAuth flow. Accepts either:
//   1. an MCP OAuth access token (issued by /oauth/token via the browser flow), or
//   2. a raw Nuphos session token (the manual `--header` path from #285).
const requireMcpAuth: MiddlewareHandler<{ Variables: McpVariables }> = async (c, next) => {
  const challenge = `Bearer resource_metadata="${config.auth.publicBaseUrl}/.well-known/oauth-protected-resource"`
  const header = c.req.header('Authorization')

  if (!header?.startsWith('Bearer ')) {
    c.header('WWW-Authenticate', challenge)

    return c.json({ error: 'unauthorized', error_description: 'Authorization required' }, 401)
  }

  const token = header.slice('Bearer '.length)
  const claims = verifyAccessToken(
    token,
    mcpResourceUrl(config.auth.publicBaseUrl),
    config.auth.publicBaseUrl,
  )
  let userId: string | null = claims?.sub ?? null

  if (!userId) {
    // Back-compat: accept a raw Nuphos session token so the paste-a-token path
    // keeps working alongside the OAuth flow.
    userId = (await authenticateToken(token))?.user.id ?? null
  }
  if (!userId || !ObjectId.isValid(userId)) {
    c.header('WWW-Authenticate', `${challenge}, error="invalid_token"`)

    return c.json({ error: 'invalid_token', error_description: 'Invalid or expired token' }, 401)
  }

  c.set('userId', userId)
  c.set('mcpOauthClientId', claims?.client_id)
  await next()
}

mcp.use('*', requireMcpAuth)

mcp.post('/', async (c) => {
  // Attribute the caller: OAuth registration name (Claude Code, Codex, …) is
  // the strongest signal; User-Agent covers the raw-token path.
  const oauthClientId = c.get('mcpOauthClientId')
  const oauthClient = oauthClientId ? await getClient(oauthClientId).catch(() => null) : null
  const userAgent = c.req.header('User-Agent')
  const clientMeta: AgentClientMeta = {
    ...(oauthClient?.clientName ? { name: oauthClient.clientName } : {}),
    ...(oauthClientId ? { oauthClientId } : {}),
    ...(userAgent ? { userAgent } : {}),
  }
  const tools = toolsForContext({
    userId: c.get('userId'),
    client: Object.keys(clientMeta).length > 0 ? clientMeta : undefined,
  })

  let payload: unknown

  try {
    payload = await c.req.json()
  } catch {
    return c.json(fail(null, -32700, 'Parse error'), 400)
  }

  const { status, body } = await handleMcpHttpPayload(payload, tools)

  // All-notifications batch (or lone notification) → 202 with no body.
  if (body === null) return c.body(null, status)

  return c.json(body, status)
})

// We don't support the optional server->client SSE stream; long-running work is
// recovered via nuphos_check, not a held-open GET stream.
mcp.get('/', (c) => c.json(fail(null, -32000, 'SSE stream not supported; use POST.'), 405))
