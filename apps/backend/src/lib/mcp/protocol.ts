// Pure MCP (Model Context Protocol) protocol layer for the Nuphos Agent server.
//
// This module is intentionally dependency-free (no config, no DB, no agent
// imports) so it can be unit-tested without environment setup — `config.ts`
// throws at import time when sandbox env vars are absent, which is why the rest
// of the test suite avoids importing it transitively. The agent-touching tool
// implementations live in routes/mcp.ts and are injected here as handlers.

import {
  fail,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  ok,
  toolError,
} from './protocol-rpc'
import { TOOL_DEFINITIONS } from './protocol-tools'

import type { JsonRpcMessage, JsonRpcResponse, ToolHandler } from './protocol-rpc'

// A tool surface: what a given MCP endpoint advertises. The default surface is
// the Nuphos Agent server; scoped endpoints (e.g. the Claude Code runtime's
// credentials MCP) supply their own definitions and instructions.
export type McpSurface = {
  serverName: string
  instructions: string
  toolDefinitions: readonly unknown[]
}

export {
  fail,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  ok,
  toolError,
  toolResult,
} from './protocol-rpc'
export type {
  JsonRpcFailure,
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcResponse,
  JsonRpcSuccess,
  ToolHandler,
  ToolResult,
} from './protocol-rpc'
export { getCapabilities, TOOL_DEFINITIONS } from './protocol-tools'

// ─── JSON-RPC dispatch ──────────────────────────────────────────────────────
//
// Returns a JSON-RPC response, or null for notifications (messages with no id),
// which get no reply per the spec. Tool implementations are supplied by the
// caller as a name->handler map so this layer stays free of agent/DB imports.

// Streamable-HTTP JSON-mode framing over a parsed request body: one message or
// a batch, 202 with no body when everything was a notification, 400 for an
// empty batch. The HTTP routes own only parsing and auth.
export async function handleMcpHttpPayload(
  payload: unknown,
  tools: Record<string, ToolHandler>,
  surface?: McpSurface,
): Promise<{ status: 200 | 202 | 400; body: JsonRpcResponse | JsonRpcResponse[] | null }> {
  const isBatch = Array.isArray(payload)
  const incoming = (isBatch ? payload : [payload]) as JsonRpcMessage[]

  if (isBatch && incoming.length === 0) {
    return { status: 400, body: fail(null, -32600, 'Invalid Request') }
  }

  const responses: JsonRpcResponse[] = []

  for (const message of incoming) {
    const response = await handleMcpMessage(message, tools, surface)

    if (response) responses.push(response)
  }
  if (responses.length === 0) return { status: 202, body: null }

  return { status: 200, body: isBatch ? responses : (responses[0] ?? null) }
}

const DEFAULT_SURFACE: McpSurface = {
  serverName: MCP_SERVER_NAME,
  instructions:
    'Talk to the Nuphos Agent. Call nuphos_list_teams first — nuphos_ask ' +
    'requires a team_id from it. If a request times out, reconnect with ' +
    'nuphos_check using the same session_id. Call nuphos_capabilities to ' +
    'learn what Nuphos can do.',
  toolDefinitions: TOOL_DEFINITIONS,
}

export async function handleMcpMessage(
  message: JsonRpcMessage,
  tools: Record<string, ToolHandler>,
  surface: McpSurface = DEFAULT_SURFACE,
): Promise<JsonRpcResponse | null> {
  if (
    !message ||
    typeof message !== 'object' ||
    message.jsonrpc !== '2.0' ||
    typeof message.method !== 'string'
  ) {
    // Spec: an Invalid Request error carries id null, even if the malformed
    // message included one.
    return fail(null, -32600, 'Invalid Request')
  }

  const id = message.id ?? null
  const isNotification = message.id === undefined
  const { method, params } = message

  try {
    switch (method) {
      case 'initialize':
        if (isNotification) return null

        return ok(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: surface.serverName, version: MCP_SERVER_VERSION },
          instructions: surface.instructions,
        })
      case 'notifications/initialized':
        return null
      case 'ping':
        return isNotification ? null : ok(id, {})
      case 'tools/list':
        return isNotification ? null : ok(id, { tools: surface.toolDefinitions })
      case 'tools/call': {
        if (isNotification) return null
        const callParams = (params ?? {}) as { name?: unknown; arguments?: unknown }
        const handler = typeof callParams.name === 'string' ? tools[callParams.name] : undefined

        if (!handler) return ok(id, toolError(`Unknown tool: ${String(callParams.name)}`))
        const args =
          callParams.arguments && typeof callParams.arguments === 'object'
            ? (callParams.arguments as Record<string, unknown>)
            : {}

        return ok(id, await handler(args))
      }
      default:
        return isNotification ? null : fail(id, -32601, `Method not found: ${method}`)
    }
  } catch (err) {
    // Don't echo err.message to the client — it can carry internal details.
    console.error('[mcp] unhandled error in JSON-RPC dispatch:', err)
    if (isNotification) return null

    return fail(id, -32603, 'Internal error')
  }
}
