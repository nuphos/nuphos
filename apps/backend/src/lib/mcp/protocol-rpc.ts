// ─── JSON-RPC 2.0 ───────────────────────────────────────────────────────────

export type JsonRpcId = string | number | null

export type JsonRpcMessage = {
  jsonrpc?: unknown
  id?: JsonRpcId
  method?: unknown
  params?: unknown
}

export type JsonRpcSuccess = {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: unknown
}

export type JsonRpcFailure = {
  jsonrpc: '2.0'
  id: JsonRpcId
  error: { code: number; message: string; data?: unknown }
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

export function ok(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result }
}

export function fail(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcFailure {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}

// ─── Tool results ───────────────────────────────────────────────────────────
//
// MCP tool results carry a `content` array. We also attach `structuredContent`
// (MCP 2025-06-18) so the calling agent can consume the JSON directly instead
// of re-parsing the text block.

export type ToolResult = {
  content: { type: 'text'; text: string }[]
  structuredContent?: unknown
  isError?: boolean
}

export function toolResult(payload: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  }
}

// Business-level failures (bad args, not-a-team-member) come back as an MCP tool
// error so the calling agent can read *why* and adjust — as opposed to a
// JSON-RPC/protocol error, which we reserve for malformed requests and auth.
export function toolError(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>

// ─── Server metadata ────────────────────────────────────────────────────────

export const MCP_PROTOCOL_VERSION = '2025-06-18'
export const MCP_SERVER_NAME = 'nuphos-agent'
export const MCP_SERVER_VERSION = '0.1.0'
