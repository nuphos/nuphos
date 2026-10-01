import { expect, test } from 'bun:test'

import { OpenAbAcpClient } from './openab-acp-client'
import { createTeamRuntimeRegistry } from './team-openab-runtime'

import type { TeamPreviewClient } from './team-openab-runtime'

const dormant = {
  schemaVersion: 2,
  state: 'dormant',
  epoch: 'runtime',
  revision: 0,
  phase: 'dormant',
  label: 'Ready',
  tools: [],
  actions: { send: true, cancel: false, steer: false },
}

type SocketEvent = { code?: number; data?: string; message?: string; reason?: string }

class HalfOpenSocket {
  readonly readyState = 1
  readonly listeners = new Map<string, ((event: SocketEvent) => void)[]>()

  readonly sent: { method?: string; params?: unknown }[] = []

  constructor(
    private readonly permissionRelay = true,
    private readonly jobs?: string[],
  ) {
    queueMicrotask(() => this.emit('open', {}))
  }

  addEventListener(type: string, listener: (event: SocketEvent) => void) {
    const current = this.listeners.get(type) ?? []

    current.push(listener)
    this.listeners.set(type, current)
  }

  removeEventListener(type: string, listener: (event: SocketEvent) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
    )
  }

  send(data: string) {
    const frame = JSON.parse(data) as { id?: number; method?: string; params?: unknown }

    this.sent.push(frame)
    if (frame.method === '_openab/runtime/job') {
      queueMicrotask(() =>
        this.emit('message', {
          data: JSON.stringify({
            jsonrpc: '2.0',
            id: frame.id,
            result: { exitCode: 0, stdout: 'ok', truncated: false, timedOut: false },
          }),
        }),
      )
    }

    // The transport starts healthy, then blackholes every prompt/cancel frame
    // without delivering close/error — the production half-open failure shape.
    if (frame.method === '_openab/session/state') {
      queueMicrotask(() =>
        this.emit('message', {
          data: JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: dormant }),
        }),
      )
    }
    if (frame.method === 'initialize') {
      queueMicrotask(() => {
        this.emit('message', {
          data: JSON.stringify({
            jsonrpc: '2.0',
            id: frame.id,
            result: {
              protocolVersion: 1,
              ...(this.permissionRelay
                ? {
                    agentCapabilities: {
                      _meta: {
                        'dev.openab/permissionRelay': true,
                        'dev.openab/sessionAuthority': 2,
                        ...(this.jobs ? { 'dev.openab/runtimeJobs': this.jobs } : {}),
                      },
                    },
                  }
                : {}),
            },
          }),
        })
      })
    }
  }

  close() {
    this.emit('close', {})
  }

  private emit(type: string, event: SocketEvent) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

test('a prompt timeout retires a half-open team transport before the next acquire', async () => {
  const sockets: HalfOpenSocket[] = []
  const registry = createTeamRuntimeRegistry(async (endpoint) => {
    return OpenAbAcpClient.connect({
      ...endpoint,
      promptTimeoutMs: 5,
      socketFactory: () => {
        const socket = new HalfOpenSocket()

        sockets.push(socket)

        return socket
      },
    })
  })
  const endpoint = { url: 'wss://openab.example/acp', authKey: 'test-key' }
  const first = await registry.acquire('team-1', endpoint)

  await expect(first.prompt('session-1', 'hello', (text) => text.length)).rejects.toThrow(
    'session/prompt timed out',
  )

  const afterTimeout = await registry.acquire('team-1', endpoint)

  expect(afterTimeout).not.toBe(first)
  expect(sockets).toHaveLength(2)
})

test('rejects an OpenAB runtime that would silently auto-approve permissions', async () => {
  const registry = createTeamRuntimeRegistry(async (endpoint) => {
    return OpenAbAcpClient.connect({
      ...endpoint,
      socketFactory: () => new HalfOpenSocket(false),
    })
  })

  await expect(
    registry.acquire('team-1', {
      url: 'wss://legacy-openab.example/acp',
      authKey: 'test-key',
    }),
  ).rejects.toThrow('does not support permission relay')
})

test('a session resume timeout retires a half-open team transport before the next acquire', async () => {
  const sockets: HalfOpenSocket[] = []
  const registry = createTeamRuntimeRegistry(async (endpoint) => {
    return OpenAbAcpClient.connect({
      ...endpoint,
      callTimeoutMs: 5,
      socketFactory: () => {
        const socket = new HalfOpenSocket()

        sockets.push(socket)

        return socket
      },
    })
  })
  const endpoint = { url: 'wss://openab.example/acp', authKey: 'test-key' }
  const first = await registry.acquire('team-1', endpoint)

  await expect(first.loadSession('session-1', '/workspace')).rejects.toThrow(
    'session/resume timed out',
  )

  const afterTimeout = await registry.acquire('team-1', endpoint)

  expect(afterTimeout).not.toBe(first)
  expect(sockets).toHaveLength(2)
})

test('a session creation timeout closes a half-open team transport before the next acquire', async () => {
  const sockets: HalfOpenSocket[] = []
  const registry = createTeamRuntimeRegistry(async (endpoint) => {
    return OpenAbAcpClient.connect({
      ...endpoint,
      callTimeoutMs: 5,
      socketFactory: () => {
        const socket = new HalfOpenSocket()

        sockets.push(socket)

        return socket
      },
    })
  })
  const endpoint = { url: 'wss://openab.example/acp', authKey: 'test-key' }
  const first = await registry.acquire('team-1', endpoint)

  await expect(first.createSession('/workspace')).rejects.toThrow('session/new timed out')

  const afterTimeout = await registry.acquire('team-1', endpoint)

  expect(afterTimeout).not.toBe(first)
  expect(sockets).toHaveLength(2)
})

test('connectionInfo surfaces the build identity the runtime reported on initialize', async () => {
  const registry = createTeamRuntimeRegistry(() => {
    const client = {
      initialize: () =>
        Promise.resolve({
          agentCapabilities: {
            _meta: {
              'dev.openab/permissionRelay': true,
              'dev.openab/sessionAuthority': 2,
              'dev.openab/buildSha': '1d86daa14566',
              'dev.openab/adapterVersion': 'claude-agent-acp@0.70.0',
            },
          },
        }),
      getSessionExecutionState: async () => dormant,
      onClosed: () => {},
      onRetired: () => {},
      close: () => {},
    }

    return Promise.resolve(client as unknown as TeamPreviewClient)
  })

  await registry.acquire('team-x', { url: 'ws://rt/acp', authKey: 'k' })
  const info = registry.connectionInfo('team-x')

  expect(info.connected).toBe(true)
  expect(info.buildSha).toBe('1d86daa14566')
  expect(info.adapterVersion).toBe('claude-agent-acp@0.70.0')
})

test('refuses a legacy runtime instead of falling back to backend execution inference', async () => {
  let closed = false
  const registry = createTeamRuntimeRegistry(
    async () =>
      ({
        initialize: async () => ({
          agentCapabilities: { _meta: { 'dev.openab/permissionRelay': true } },
        }),
        getSessionExecutionState: async () => {
          throw new Error('Method not found')
        },
        close: () => {
          closed = true
        },
      }) as unknown as TeamPreviewClient,
  )

  await expect(
    registry.acquire('team', { url: 'ws://legacy/acp', authKey: 'test' }),
  ).rejects.toThrow('authoritative session state is unavailable')
  expect(closed).toBe(true)
})

test('records the jobs a runtime advertises and runs one over the control socket', async () => {
  const sockets: HalfOpenSocket[] = []
  const registry = createTeamRuntimeRegistry(async (endpoint) =>
    OpenAbAcpClient.connect({
      ...endpoint,
      socketFactory: () => {
        const socket = new HalfOpenSocket(
          true,
          endpoint.url.includes('new') ? ['panel'] : undefined,
        )

        sockets.push(socket)

        return socket
      },
    }),
  )
  const current = { url: 'wss://new.example/acp', authKey: 'test-key' }
  const outdated = { url: 'wss://old.example/acp', authKey: 'test-key' }
  const client = await registry.acquire('team-1', current)

  await registry.acquire('team-1', outdated)
  expect(registry.runtimeJobs('team-1', current)).toEqual(['panel'])
  expect(registry.runtimeJobs('team-1', outdated)).toEqual([])

  const request = {
    jobId: 'job-1',
    job: 'panel',
    stdin: '{}',
    env: { NUPHOS_TOKEN: 't' },
    timeoutMs: 1_000,
    maxStdoutBytes: 10,
  }

  await expect(client.runJob(request, 2_000)).resolves.toEqual({
    exitCode: 0,
    stdout: 'ok',
    truncated: false,
    timedOut: false,
  })
  expect(sockets[0]?.sent.at(-1)).toMatchObject({ method: '_openab/runtime/job', params: request })
})
