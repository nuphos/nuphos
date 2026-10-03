import { beforeEach, expect, spyOn, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'
import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'

import { OpenAbAcpClient } from './openab-acp-client'
import { runtimeTerminalEvents, runtimeTerminalTarget } from './runtime-terminal'

import type { WSContext } from 'hono/ws'

let conversation: Record<string, unknown> | null
let runtimeId = 'runtime'

useAgentDb({ getReadableConversation: () => conversation })
useRuntimeCatalog({
  requireRuntimeInstance: () => ({
    id: runtimeId,
    label: 'Selected runtime',
    status: 'active',
    kind: 'external',
    provider: 'codex',
  }),
})
useRuntimeRegistry({
  resolveTeamRuntimeEndpoints: () => [
    { runtimeId: 'runtime', url: 'wss://runtime/acp', authKey: 'fixture' },
  ],
})
beforeEach(() => {
  conversation = { userId: 'owner', teamId: 'team', runtimeId: 'runtime' }
  runtimeId = 'runtime'
})

test('resolves the conversation source using the operator channel', async () => {
  const target = await runtimeTerminalTarget('team', 'owner', 'conversation')

  expect(target.runtimeId).toBe('runtime')
  expect(target.sessionId).toBe('conversation')
  expect(target.endpoint.url).toBe('wss://runtime/acp')
})
test('a shared transcript does not authorize a runtime shell', async () => {
  for (const value of [
    null,
    { userId: 'another', teamId: 'team', runtimeId: 'runtime' },
    { userId: 'owner', teamId: 'different', runtimeId: 'runtime' },
    { userId: 'owner', teamId: 'team' },
  ]) {
    conversation = value
    await expect(runtimeTerminalTarget('team', 'owner', 'conversation')).rejects.toThrow(
      'Conversation runtime not found',
    )
  }
})
test('does not substitute another runtime when the source is missing', async () => {
  runtimeId = 'missing'
  await expect(runtimeTerminalTarget('team', 'owner', 'conversation')).rejects.toThrow('offline')
})

test('input frames retain socket order without waiting a round trip for each keystroke', async () => {
  const input: string[] = []
  const finish: (() => void)[] = []
  const client = {
    initialize: async () => ({
      agentCapabilities: { _meta: { 'dev.openab/runtimeTerminal': true } },
    }),
    onClosed: () => () => {},
    close: () => {},
    terminalRequest: (operation: string, params: { data?: string }) => {
      if (operation !== 'input') return Promise.resolve({})
      input.push(params.data!)

      return new Promise((resolve) => finish.push(() => resolve({})))
    },
  } as unknown as OpenAbAcpClient
  const connect = spyOn(OpenAbAcpClient, 'connect').mockResolvedValue(client)
  const ws = { send: () => {}, close: () => {} } as unknown as WSContext
  const events = runtimeTerminalEvents({
    endpoint: { url: 'wss://fixture', authKey: 'fixture' },
    runtimeId: 'runtime',
    userId: 'owner',
    label: 'Runtime',
    sessionId: 'conversation',
  })

  try {
    events.onOpen?.(new Event('open'), ws)
    await new Promise((resolve) => setTimeout(resolve, 0))
    events.onMessage?.(
      new MessageEvent('message', { data: JSON.stringify({ type: 'input', data: 'a' }) }),
      ws,
    )
    events.onMessage?.(
      new MessageEvent('message', { data: JSON.stringify({ type: 'input', data: 'b' }) }),
      ws,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(input).toEqual(['a', 'b'])
  } finally {
    for (const resolve of finish) resolve()
    events.onClose?.(new CloseEvent('close'), ws)
    connect.mockRestore()
  }
})

test('parallel sockets share user admission and closing twice releases only one slot', async () => {
  const finish: (() => void)[] = []
  const client = {
    initialize: async () => ({
      agentCapabilities: { _meta: { 'dev.openab/runtimeTerminal': true } },
    }),
    onClosed: () => () => {},
    close: () => {},
    terminalRequest: () => new Promise((resolve) => finish.push(() => resolve({}))),
  } as unknown as OpenAbAcpClient
  const connect = spyOn(OpenAbAcpClient, 'connect').mockResolvedValue(client)
  const frames: string[] = []
  const ws = { send: (data: string) => frames.push(data), close: () => {} } as unknown as WSContext
  const target = {
    endpoint: { url: 'wss://fixture', authKey: 'fixture' },
    runtimeId: 'runtime',
    userId: 'quota-owner',
    label: 'Runtime',
    sessionId: 'conversation',
  }
  const sockets = Array.from({ length: 9 }, () => runtimeTerminalEvents(target))

  try {
    for (const socket of sockets) socket.onOpen?.(new Event('open'), ws)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(connect).toHaveBeenCalledTimes(8)
    expect(frames.some((frame) => frame.includes('Close a runtime terminal'))).toBe(true)
    sockets[0]!.onClose?.(new CloseEvent('close'), ws)
    sockets[0]!.onClose?.(new CloseEvent('close'), ws)
    const replacement = runtimeTerminalEvents(target)

    sockets.push(replacement)
    replacement.onOpen?.(new Event('open'), ws)
    const refused = runtimeTerminalEvents(target)

    sockets.push(refused)
    refused.onOpen?.(new Event('open'), ws)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(connect).toHaveBeenCalledTimes(9)
  } finally {
    for (const socket of sockets) socket.onClose?.(new CloseEvent('close'), ws)
    for (const resolve of finish) resolve()
    connect.mockRestore()
  }
})

test('before start resolves only output acknowledgements are accepted, not input', async () => {
  let finish!: () => void
  const operations: string[] = []
  const client = {
    initialize: async () => ({
      agentCapabilities: { _meta: { 'dev.openab/runtimeTerminal': true } },
    }),
    onClosed: () => () => {},
    close: () => {},
    terminalRequest: (operation: string) => {
      operations.push(operation)

      return operation === 'start'
        ? new Promise((resolve) => {
            finish = () => resolve({})
          })
        : Promise.resolve({})
    },
  } as unknown as OpenAbAcpClient
  const connect = spyOn(OpenAbAcpClient, 'connect').mockResolvedValue(client)
  const ws = { send: () => {}, close: () => {} } as unknown as WSContext
  const events = runtimeTerminalEvents({
    endpoint: { url: 'wss://fixture', authKey: 'fixture' },
    runtimeId: 'runtime',
    userId: 'starting-owner',
    label: 'Runtime',
    sessionId: 'conversation',
  })

  try {
    events.onOpen?.(new Event('open'), ws)
    await new Promise((resolve) => setTimeout(resolve, 0))
    events.onMessage?.(
      new MessageEvent('message', { data: JSON.stringify({ type: 'ack', sequence: 1 }) }),
      ws,
    )
    events.onMessage?.(
      new MessageEvent('message', { data: JSON.stringify({ type: 'input', data: 'not-yet' }) }),
      ws,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(operations).toEqual(['start', 'ack'])
  } finally {
    events.onClose?.(new CloseEvent('close'), ws)
    finish()
    connect.mockRestore()
  }
})

test('escaped input survives, oversized input is dropped, and start uses measured geometry', async () => {
  const requests: { operation: string; params: Record<string, unknown> }[] = []
  let closed = false
  const client = {
    initialize: async () => ({
      agentCapabilities: { _meta: { 'dev.openab/runtimeTerminal': true } },
    }),
    onClosed: () => () => {},
    close: () => {
      closed = true
    },
    terminalRequest: async (operation: string, params: Record<string, unknown>) => {
      requests.push({ operation, params })

      return {}
    },
  } as unknown as OpenAbAcpClient
  const connect = spyOn(OpenAbAcpClient, 'connect').mockResolvedValue(client)
  const ws = {
    send: () => {},
    close: () => {
      closed = true
    },
  } as unknown as WSContext
  const target = {
    endpoint: { url: 'wss://fixture', authKey: 'fixture' },
    runtimeId: 'runtime',
    userId: 'paste-owner',
    label: 'Runtime',
    sessionId: 'conversation',
  }
  const events = runtimeTerminalEvents(target, { cols: '132', rows: '43' })
  const send = async (data: string) => {
    events.onMessage?.(
      new MessageEvent('message', { data: JSON.stringify({ type: 'input', data }) }),
      ws,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  try {
    events.onOpen?.(new Event('open'), ws)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requests[0]?.params).toMatchObject({ cols: 132, rows: 43 })
    for (const data of [
      '"'.repeat(16384),
      '\\'.repeat(16384),
      '\x00'.repeat(16384),
      '界'.repeat(5461),
    ]) {
      await send(data)
      expect(requests.at(-1)?.params.data).toBe(data)
    }
    const count = requests.length

    await send('x'.repeat(16385))
    await send('界'.repeat(5462))
    await send('\x00'.repeat(17000))
    expect(requests).toHaveLength(count)
    expect(closed).toBe(false)
    await send('still usable')
    expect(requests.at(-1)?.params.data).toBe('still usable')
    expect(closed).toBe(false)
  } finally {
    events.onClose?.(new CloseEvent('close'), ws)
    connect.mockRestore()
  }
})
