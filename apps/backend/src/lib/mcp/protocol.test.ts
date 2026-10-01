import { describe, expect, test } from 'bun:test'

import { getCapabilities, handleMcpHttpPayload, handleMcpMessage, toolResult } from './protocol'

import type { ToolHandler } from './protocol'

// Real capabilities handler + stubs for the agent-touching tools, so the
// protocol layer can be tested without a DB or an agent run.
const tools: Record<string, ToolHandler> = {
  nuphos_capabilities: async () => toolResult(getCapabilities()),
  nuphos_ask: async () => toolResult({ status: 'completed', session_id: 's', answer: 'stub' }),
  nuphos_check: async () => toolResult({ status: 'running', session_id: 's' }),
  nuphos_list_teams: async () =>
    toolResult({ teams: [{ team_id: 't1', name: 'Team', role: 'EDITOR' }] }),
  nuphos_list_credentials: async () => toolResult({ team_id: 't1', options: {} }),
  nuphos_update_credentials: async () => toolResult({ session_id: 's', enabled_for_session: {} }),
}

describe('handleMcpMessage', () => {
  test('initialize advertises tools capability and server info', async () => {
    const res = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' }, tools)

    expect(res).not.toBeNull()
    const result = (res as { result: any }).result

    expect(result.protocolVersion).toBe('2025-06-18')
    expect(result.capabilities.tools).toBeDefined()
    expect(result.serverInfo.name).toBe('nuphos-agent')
  })

  test('tools/list returns exactly the advertised tools', async () => {
    const res = await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, tools)
    const list = (res as { result: { tools: { name: string }[] } }).result.tools

    expect(list.map((t) => t.name).sort((a, b) => a.localeCompare(b))).toEqual([
      'nuphos_ask',
      'nuphos_capabilities',
      'nuphos_check',
      'nuphos_list_credentials',
      'nuphos_list_teams',
      'nuphos_update_credentials',
    ])
  })

  test('nuphos_ask requires prompt and team_id', async () => {
    const res = await handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, tools)
    const list = (res as { result: { tools: any[] } }).result.tools
    const ask = list.find((t) => t.name === 'nuphos_ask')

    expect(ask.inputSchema.properties.team_id).toBeDefined()
    expect(ask.inputSchema.required).toEqual(['prompt', 'team_id'])
  })

  test('nuphos_update_credentials accepts Uptime Kuma credential ids', async () => {
    const res = await handleMcpMessage({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, tools)
    const list = (res as { result: { tools: any[] } }).result.tools
    const updateCredentials = list.find((t) => t.name === 'nuphos_update_credentials')

    expect(updateCredentials.inputSchema.properties.uptime_kuma_instance_ids).toEqual({
      type: 'array',
      items: { type: 'string' },
    })
  })

  test('tools/call nuphos_capabilities returns structured capabilities', async () => {
    const res = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'nuphos_capabilities', arguments: {} },
      },
      tools,
    )
    const result = (res as { result: any }).result

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent.agent).toBe('nuphos-agent')
    expect(Array.isArray(result.structuredContent.supported_task_types)).toBe(true)
  })

  test('tools/call on an unknown tool is an MCP tool error, not a protocol error', async () => {
    const res = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'nuphos_nope', arguments: {} },
      },
      tools,
    )
    const result = (res as { result: any }).result

    expect(result.isError).toBe(true)
  })

  test('ping returns an empty result', async () => {
    const res = await handleMcpMessage({ jsonrpc: '2.0', id: 6, method: 'ping' }, tools)

    expect((res as { result: unknown }).result).toEqual({})
  })

  test('notifications/initialized (no id) yields no response', async () => {
    const res = await handleMcpMessage(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      tools,
    )

    expect(res).toBeNull()
  })

  test('unknown method returns JSON-RPC method-not-found', async () => {
    const res = await handleMcpMessage({ jsonrpc: '2.0', id: 7, method: 'does/not/exist' }, tools)

    expect((res as { error: { code: number } }).error.code).toBe(-32601)
  })

  test('malformed message returns JSON-RPC invalid-request with id null', async () => {
    const res = await handleMcpMessage({ id: 8, method: 'initialize' } as any, tools)

    expect((res as { error: { code: number } }).error.code).toBe(-32600)
    expect((res as { id: unknown }).id).toBeNull()
  })

  test('initialize as a notification (no id) yields no response', async () => {
    const res = await handleMcpMessage({ jsonrpc: '2.0', method: 'initialize' }, tools)

    expect(res).toBeNull()
  })

  test('an unexpected tool exception maps to a generic -32603 without the message', async () => {
    const res = await handleMcpMessage(
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'boom', arguments: {} } },
      {
        boom: async () => {
          throw new Error('secret internal detail')
        },
      },
    )
    const error = (res as { error: { code: number; message: string } }).error

    expect(error.code).toBe(-32603)
    expect(error.message).toBe('Internal error')
  })

  test('a custom surface replaces server info, instructions, and the tool list', async () => {
    const surface = {
      serverName: 'nuphos-credentials',
      instructions: 'Scoped credential tools.',
      toolDefinitions: [{ name: 'list_credentials' }],
    }
    const init = await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      {},
      surface,
    )
    const initResult = (init as { result: any }).result

    expect(initResult.serverInfo.name).toBe('nuphos-credentials')
    expect(initResult.instructions).toBe('Scoped credential tools.')

    const list = await handleMcpMessage(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      {},
      surface,
    )

    expect((list as { result: { tools: unknown } }).result.tools).toEqual([
      { name: 'list_credentials' },
    ])
  })
})

describe('handleMcpHttpPayload', () => {
  test('an empty batch is an invalid request', async () => {
    const { status, body } = await handleMcpHttpPayload([], tools)

    expect(status).toBe(400)
    expect((body as { error: { code: number } }).error.code).toBe(-32600)
  })

  test('a lone notification yields 202 with no body', async () => {
    const { status, body } = await handleMcpHttpPayload(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      tools,
    )

    expect(status).toBe(202)
    expect(body).toBeNull()
  })

  test('a batch returns an array response in order', async () => {
    const { status, body } = await handleMcpHttpPayload(
      [
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ],
      tools,
    )

    expect(status).toBe(200)
    expect(Array.isArray(body)).toBe(true)
    expect((body as { id: number }[]).map((entry) => entry.id)).toEqual([1, 2])
  })
})
