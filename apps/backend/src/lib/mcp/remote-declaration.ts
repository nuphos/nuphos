import { pinnedFetch } from '@/lib/net/safe-outbound'

import type { McpToolDeclaration } from './declaration-budget'

export type McpHttpResponse = {
  status: number
  contentType: string
  text: string
  sessionId?: string
}

export type McpPost = (
  url: string,
  headers: Record<string, string>,
  body: unknown,
) => Promise<McpHttpResponse>

const PROTOCOL = '2025-03-26'

/** One JSON-RPC message from a streamable-HTTP or SSE response body. */
export function mcpMessageFromHttp(contentType: string, text: string): unknown {
  const body = text.trim()

  if (!body) return undefined
  if (contentType.includes('text/event-stream')) {
    const data = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((line) => line.length > 0 && line !== '[DONE]')
    const last = data.at(-1)

    return last ? (JSON.parse(last) as unknown) : undefined
  }

  return JSON.parse(body) as unknown
}

function resultOf(message: unknown): Record<string, unknown> | undefined {
  if (!message || typeof message !== 'object') return undefined
  const result = (message as { result?: unknown }).result

  return result && typeof result === 'object' ? (result as Record<string, unknown>) : undefined
}

export function instructionsOf(message: unknown): string {
  const instructions = resultOf(message)?.instructions

  return typeof instructions === 'string' ? instructions : ''
}

export function toolsOf(message: unknown): McpToolDeclaration[] {
  const tools = resultOf(message)?.tools

  if (!Array.isArray(tools)) return []

  return tools.flatMap((tool) => {
    if (!tool || typeof tool !== 'object') return []
    const record = tool as Record<string, unknown>

    if (typeof record.name !== 'string' || !record.name) return []

    return [
      {
        name: record.name,
        ...(typeof record.description === 'string' ? { description: record.description } : {}),
        ...(record.inputSchema !== undefined ? { inputSchema: record.inputSchema } : {}),
      },
    ]
  })
}

function readMessage(response: McpHttpResponse): unknown {
  if (response.status < 200 || response.status >= 300) throw new Error('MCP tool list failed')
  let message: unknown

  try {
    message = mcpMessageFromHttp(response.contentType, response.text)
  } catch {
    throw new Error('MCP tool list failed')
  }
  if (!message || typeof message !== 'object') throw new Error('MCP tool list failed')
  if ('error' in message && (message as { error?: unknown }).error) {
    throw new Error('MCP tool list failed')
  }

  return message
}

async function pinnedPost(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<McpHttpResponse> {
  const response = await pinnedFetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  })

  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    text: await response.text(),
    sessionId: response.headers.get('mcp-session-id') ?? undefined,
  }
}

/**
 * `initialize` plus `tools/list` for one remote server. Failures name no header
 * and no response body: both can echo a credential.
 */
export async function listRemoteMcpDeclaration(
  url: string,
  headers: { name: string; value: string }[],
  post: McpPost = pinnedPost,
): Promise<{ tools: McpToolDeclaration[]; instructions: string }> {
  const base = Object.fromEntries(headers.map((header) => [header.name, header.value]))
  const opened = await post(url, base, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: 'nuphos', version: '0' },
    },
  })
  const init = readMessage(opened)
  const follow = opened.sessionId ? { ...base, 'mcp-session-id': opened.sessionId } : base

  await post(url, follow, { jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => null)
  const listed = readMessage(
    await post(url, follow, { jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  )

  return { tools: toolsOf(listed), instructions: instructionsOf(init) }
}
