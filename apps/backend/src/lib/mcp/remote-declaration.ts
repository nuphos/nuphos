import { pinnedFetch } from '@/lib/net/safe-outbound'

import { declarationBytes } from './declaration-budget'

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
const MAX_DECLARATION_RESPONSE_BYTES = 512 * 1024
const MAX_TOOL_LIST_PAGES = 20

function messageIdOf(message: unknown): unknown {
  return message && typeof message === 'object' ? (message as { id?: unknown }).id : undefined
}

/** One JSON-RPC message from a streamable-HTTP or SSE response body. */
export function mcpMessageFromHttp(
  contentType: string,
  text: string,
  expectedId?: number | string,
): unknown {
  const body = text.trim()

  if (!body) return undefined
  if (contentType.toLowerCase().includes('text/event-stream')) {
    const messages = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((line) => line.length > 0 && line !== '[DONE]')
      .map((payload) => JSON.parse(payload) as unknown)

    if (expectedId !== undefined) {
      return messages.find((message) => messageIdOf(message) === expectedId)
    }

    return (
      messages.findLast(
        (message) =>
          Boolean(message && typeof message === 'object') &&
          ('result' in (message as object) || 'error' in (message as object)),
      ) ?? messages.at(-1)
    )
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

function nextCursorOf(message: unknown): string | undefined {
  const cursor = resultOf(message)?.nextCursor

  return typeof cursor === 'string' && cursor.length > 0 ? cursor : undefined
}

function readMessage(response: McpHttpResponse, expectedId?: number | string): unknown {
  if (response.status < 200 || response.status >= 300) throw new Error('MCP tool list failed')
  let message: unknown

  try {
    message = mcpMessageFromHttp(response.contentType, response.text, expectedId)
  } catch {
    throw new Error('MCP tool list failed')
  }
  if (!message || typeof message !== 'object') throw new Error('MCP tool list failed')
  if (expectedId !== undefined && messageIdOf(message) !== expectedId) {
    throw new Error('MCP tool list failed')
  }
  if ('error' in message && (message as { error?: unknown }).error) {
    throw new Error('MCP tool list failed')
  }

  return message
}

async function readBoundedText(response: Response, limit: number): Promise<string> {
  const contentLength = Number(response.headers.get('content-length') ?? '')

  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw new Error('MCP tool list failed')
  }
  if (!response.body) {
    const text = await response.text()

    if (Buffer.byteLength(text) > limit) throw new Error('MCP tool list failed')

    return text
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      throw new Error('MCP tool list failed')
    }
    chunks.push(value)
  }

  return Buffer.concat(chunks).toString('utf8')
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
    text: await readBoundedText(response, MAX_DECLARATION_RESPONSE_BYTES),
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
  maxBytes?: number,
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
  const init = readMessage(opened, 1)
  const instructions = instructionsOf(init)
  const follow = opened.sessionId ? { ...base, 'mcp-session-id': opened.sessionId } : base

  await post(url, follow, { jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => null)

  const tools: McpToolDeclaration[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  for (let page = 0; page < MAX_TOOL_LIST_PAGES; page++) {
    const id = page + 2
    const listed = readMessage(
      await post(url, follow, {
        jsonrpc: '2.0',
        id,
        method: 'tools/list',
        ...(cursor ? { params: { cursor } } : {}),
      }),
      id,
    )

    tools.push(...toolsOf(listed))
    if (maxBytes !== undefined && declarationBytes(tools, instructions) > maxBytes) {
      return { tools, instructions }
    }
    const nextCursor = nextCursorOf(listed)

    if (!nextCursor) return { tools, instructions }
    if (seenCursors.has(nextCursor)) throw new Error('MCP tool list failed')
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }

  throw new Error('MCP tool list failed')
}
