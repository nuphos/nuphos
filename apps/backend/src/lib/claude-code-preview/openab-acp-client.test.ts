import { describe, expect, test } from 'bun:test'

import { OpenAbAcpClient } from './openab-acp-client'

class FakeSocket {
  static readonly OPEN = 1
  readonly sent: string[] = []
  readonly protocol: string
  readyState = 0
  closeCalls = 0
  readonly listeners = new Map<
    string,
    ((event: { code?: number; data?: string; message?: string; reason?: string }) => void)[]
  >()

  constructor(
    readonly url: string,
    readonly protocols: string[],
    autoOpen = true,
  ) {
    this.protocol = protocols.at(-1) ?? ''
    if (autoOpen) {
      queueMicrotask(() => {
        this.readyState = FakeSocket.OPEN
        this.emit('open', {})
      })
    }
  }

  addEventListener(
    type: string,
    listener: (event: { code?: number; data?: string; message?: string; reason?: string }) => void,
  ) {
    const current = this.listeners.get(type) ?? []

    current.push(listener)
    this.listeners.set(type, current)
  }

  removeEventListener(
    type: string,
    listener: (event: { code?: number; data?: string; message?: string; reason?: string }) => void,
  ) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
    )
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.closeCalls++
    this.emit('close', {})
  }

  receive(value: unknown) {
    this.emit('message', { data: JSON.stringify(value) })
  }

  fail() {
    this.emit('error', {})
  }

  reject(code: number, reason: string) {
    this.emit('close', { code, reason })
  }

  private emit(
    type: string,
    event: { code?: number; data?: string; message?: string; reason?: string },
  ) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function harness(autoOpen = true) {
  let socket: FakeSocket | undefined
  const connect = (url: string, protocols: string[]) => {
    socket = new FakeSocket(url, protocols, autoOpen)

    return socket
  }

  return {
    connect,
    socket: () => {
      if (!socket) throw new Error('socket was not created')

      return socket
    },
  }
}

async function nextSent(socket: FakeSocket, index: number) {
  for (let attempt = 0; attempt < 10 && socket.sent.length <= index; attempt++) {
    await Bun.sleep(0)
  }

  return JSON.parse(socket.sent[index]!) as Record<string, unknown>
}

describe('OpenAbAcpClient', () => {
  test('times out a WebSocket that never opens', async () => {
    const h = harness(false)

    await expect(
      OpenAbAcpClient.connect({
        url: 'wss://openab.example/acp',
        authKey: 'transport-key',
        socketFactory: h.connect,
        connectTimeoutMs: 5,
      }),
    ).rejects.toThrow('timed out')
  })

  test('surfaces the WebSocket close code and reason when the ACP handshake is rejected', async () => {
    const h = harness(false)
    const connecting = OpenAbAcpClient.connect({
      url: 'wss://openab.example/acp',
      authKey: 'transport-key',
      socketFactory: h.connect,
    })

    h.socket().reject(4401, 'invalid or missing token')

    await expect(connecting).rejects.toThrow(
      'Failed to connect to OpenAB ACP endpoint (close code 4401: invalid or missing token)',
    )
  })

  test('times out an ACP request that never receives a response', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'wss://openab.example/acp',
      authKey: 'transport-key',
      socketFactory: h.connect,
      callTimeoutMs: 5,
    })

    await expect(client.initialize()).rejects.toThrow('initialize timed out')
  })

  test('closes the shared transport when session creation times out', async () => {
    const h = harness()
    const connecting = OpenAbAcpClient.connect({
      url: 'wss://openab.example/acp',
      authKey: 'token',
      socketFactory: h.connect,
      callTimeoutMs: 5,
    })

    const client = await connecting

    await expect(client.createSession('/workspace')).rejects.toThrow('session/new timed out')
    expect(h.socket().closeCalls).toBe(1)
  })

  test('cancels the timed-out prompt before closing an otherwise idle retired transport', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'wss://openab.example/acp',
      authKey: 'transport-key',
      socketFactory: h.connect,
      promptTimeoutMs: 5,
    })

    await expect(client.prompt('sess-slow', 'hello', () => {})).rejects.toThrow(
      'session/prompt timed out',
    )
    expect(JSON.parse(h.socket().sent.at(-1)!)).toEqual({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: 'sess-slow' },
    })
    expect(h.socket().closeCalls).toBe(1)
  })

  test('re-arms the prompt deadline on each streamed update', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'wss://openab.example/acp',
      authKey: 'transport-key',
      socketFactory: h.connect,
      promptTimeoutMs: 40,
    })
    let settled = false
    const prompting = client
      .prompt('sess-live', 'hello', () => {})
      .finally(() => {
        settled = true
      })
    const promptFrame = await nextSent(h.socket(), 0)

    // Four heartbeats at 25ms each span 100ms — far past the 40ms window — but
    // each frame re-arms the timer, so the prompt must not time out.
    for (let i = 0; i < 4; i++) {
      await Bun.sleep(25)
      h.socket().receive({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: 'sess-live', update: { sessionUpdate: 'session_info_update' } },
      })
    }
    expect(settled).toBe(false)

    h.socket().receive({ jsonrpc: '2.0', id: promptFrame.id, result: { stopReason: 'end_turn' } })
    await expect(prompting).resolves.toEqual({ stopReason: 'end_turn' })
  })

  test('gives up on a prompt that only heartbeats past the progress window', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'wss://openab.example/acp',
      authKey: 'transport-key',
      socketFactory: h.connect,
      promptTimeoutMs: 40,
      promptProgressTimeoutMs: 60,
    })
    const prompting = client.prompt('sess-orphaned', 'hello', () => {})

    await nextSent(h.socket(), 0)

    const heartbeats = setInterval(() => {
      h.socket().receive({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: 'sess-orphaned', update: { sessionUpdate: 'session_info_update' } },
      })
    }, 10)

    try {
      await expect(prompting).rejects.toThrow('session/prompt timed out: no turn progress')
    } finally {
      clearInterval(heartbeats)
    }
    await Bun.sleep(10)
    expect(h.socket().closeCalls).toBe(0)
    expect(JSON.parse(h.socket().sent.at(-1)!)).toEqual({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: 'sess-orphaned' },
    })
  })

  test('keeps a turn alive past the progress window while tools keep reporting', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'wss://openab.example/acp',
      authKey: 'transport-key',
      socketFactory: h.connect,
      promptTimeoutMs: 40,
      promptProgressTimeoutMs: 60,
    })
    let settled = false
    const prompting = client
      .prompt('sess-long', 'hello', () => {})
      .finally(() => {
        settled = true
      })
    const promptFrame = await nextSent(h.socket(), 0)

    for (let i = 0; i < 10; i++) {
      await Bun.sleep(20)
      h.socket().receive({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'sess-long',
          update: { sessionUpdate: i % 2 ? 'tool_call' : 'tool_call_update', toolCallId: `t${i}` },
        },
      })
    }
    expect(settled).toBe(false)

    h.socket().receive({ jsonrpc: '2.0', id: promptFrame.id, result: { stopReason: 'end_turn' } })
    await expect(prompting).resolves.toEqual({ stopReason: 'end_turn' })
  })

  test('does not time out a silent tool that outlasts the idle window while heartbeats flow', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'wss://openab.example/acp',
      authKey: 'transport-key',
      socketFactory: h.connect,
      promptTimeoutMs: 40,
      promptProgressTimeoutMs: 400,
    })
    let settled = false
    const prompting = client
      .prompt('sess-deploy-wait', 'hello', () => {})
      .finally(() => {
        settled = true
      })
    const promptFrame = await nextSent(h.socket(), 0)

    h.socket().receive({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess-deploy-wait',
        update: { sessionUpdate: 'tool_call', toolCallId: 'sleep-125', status: 'in_progress' },
      },
    })
    for (let i = 0; i < 8; i++) {
      await Bun.sleep(20)
      h.socket().receive({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'sess-deploy-wait',
          update: { sessionUpdate: 'session_info_update', updatedAt: new Date().toISOString() },
        },
      })
    }
    expect(settled).toBe(false)

    h.socket().receive({ jsonrpc: '2.0', id: promptFrame.id, result: { stopReason: 'end_turn' } })
    await expect(prompting).resolves.toEqual({ stopReason: 'end_turn' })
  })

  test('times out a prompt that streams nothing for the inactivity window', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'wss://openab.example/acp',
      authKey: 'transport-key',
      socketFactory: h.connect,
      promptTimeoutMs: 5,
    })

    await expect(client.prompt('sess-silent', 'hello', () => {})).rejects.toThrow(
      'session/prompt timed out',
    )
    expect(JSON.parse(h.socket().sent.at(-1)!)).toEqual({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: 'sess-silent' },
    })
  })

  test('closes a retired transport after unrelated pending work drains', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'wss://openab.example/acp',
      authKey: 'transport-key',
      socketFactory: h.connect,
      callTimeoutMs: 100,
      promptTimeoutMs: 5,
    })
    const creating = client.createSession('/workspace')
    const createFrame = await nextSent(h.socket(), 0)
    const prompting = client.prompt('sess-slow', 'hello', () => {})

    await nextSent(h.socket(), 1)
    await expect(prompting).rejects.toThrow('session/prompt timed out')
    expect(h.socket().closeCalls).toBe(0)

    h.socket().receive({
      jsonrpc: '2.0',
      id: createFrame.id,
      result: { sessionId: 'sess-unrelated' },
    })
    await expect(creating).resolves.toBe('sess-unrelated')
    expect(h.socket().closeCalls).toBe(1)
  })

  test('force closes a retired transport when unrelated work does not drain', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'wss://openab.example/acp',
      authKey: 'transport-key',
      socketFactory: h.connect,
      callTimeoutMs: 100,
      promptTimeoutMs: 5,
      retireGraceMs: 15,
    })
    const creationOutcome = client.createSession('/workspace').catch((error: unknown) => error)

    await nextSent(h.socket(), 0)
    const prompting = client.prompt('sess-slow', 'hello', () => {})

    await nextSent(h.socket(), 1)
    await expect(prompting).rejects.toThrow('session/prompt timed out')
    expect(h.socket().closeCalls).toBe(0)

    await Bun.sleep(25)

    expect(h.socket().closeCalls).toBe(1)
    expect(await creationOutcome).toBeInstanceOf(Error)
  })

  test('authenticates with OpenAB subprotocol and initializes ACP v1', async () => {
    const h = harness()
    const clientPromise = OpenAbAcpClient.connect({
      url: 'wss://openab.example/acp',
      authKey: 'transport-key',
      socketFactory: h.connect,
    })
    const client = await clientPromise
    const initialize = client.initialize()
    const request = await nextSent(h.socket(), 0)

    expect(h.socket().protocols).toEqual(['openab.bearer.transport-key', 'acp.v1'])
    expect(request).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientInfo: { name: 'nuphos', version: 'poc' },
        clientCapabilities: { _meta: { 'dev.openab/sessionSnapshots': true } },
      },
    })

    h.socket().receive({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } })
    await expect(initialize).resolves.toEqual({ protocolVersion: 1 })
  })

  test('creates a session and streams OpenAB text chunks for a prompt', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'ws://openab/acp',
      authKey: 'key',
      socketFactory: h.connect,
    })
    const initialized = client.initialize()

    await nextSent(h.socket(), 0)
    h.socket().receive({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } })
    await initialized

    const creating = client.createSession('/workspace')

    expect(await nextSent(h.socket(), 1)).toMatchObject({
      id: 2,
      method: 'session/new',
      params: { cwd: '/workspace', mcpServers: [] },
    })
    h.socket().receive({ jsonrpc: '2.0', id: 2, result: { sessionId: 'sess_openab' } })
    expect(await creating).toBe('sess_openab')

    const deltas: string[] = []
    const prompting = client.prompt('sess_openab', 'hello', (text) => deltas.push(text))

    expect(await nextSent(h.socket(), 2)).toMatchObject({
      id: 3,
      method: 'session/prompt',
      params: {
        sessionId: 'sess_openab',
        prompt: [{ type: 'text', text: 'hello' }],
      },
    })
    h.socket().receive({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess_openab',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: '你' },
        },
      },
    })
    h.socket().receive({ jsonrpc: '2.0', id: 3, result: { stopReason: 'end_turn' } })

    expect(await prompting).toEqual({ stopReason: 'end_turn' })
    expect(deltas).toEqual(['你'])
  })

  test('delivers post-prompt updates to the persistent session observer only', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'ws://openab/acp',
      authKey: 'key',
      socketFactory: h.connect,
    })
    const observed: unknown[] = []

    client.onSessionUpdate('sess_timer', (update) => observed.push(update))
    const deltas: string[] = []
    const prompting = client.prompt('sess_timer', 'set a timer', (text) => deltas.push(text))
    const request = await nextSent(h.socket(), 0)

    h.socket().receive({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess_timer',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Timer set.' },
        },
      },
    })
    h.socket().receive({ jsonrpc: '2.0', id: request.id, result: { stopReason: 'end_turn' } })
    await prompting

    h.socket().receive({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess_timer',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'The timer fired.' },
        },
      },
    })
    h.socket().receive({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess_timer',
        update: {
          sessionUpdate: 'session_info_update',
          _meta: { codex: { threadStatus: { type: 'idle' } } },
        },
      },
    })
    h.socket().receive({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess_timer',
        update: {
          sessionUpdate: 'usage_update',
          used: 12,
          size: 200_000,
        },
      },
    })
    h.socket().receive({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess_timer',
        update: {
          sessionUpdate: 'usage_update',
          _meta: { '_claude/origin': { kind: 'task-notification' } },
        },
      },
    })

    expect(deltas).toEqual(['Timer set.'])
    expect(observed).toEqual([
      { kind: 'text', text: 'The timer fired.' },
      { kind: 'status', status: 'idle' },
      { kind: 'complete', origin: { kind: 'task-notification' } },
    ])
  })

  test('does not end an autonomous turn on ordinary usage snapshots between tool updates', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'ws://openab/acp',
      authKey: 'key',
      socketFactory: h.connect,
    })
    const observed: unknown[] = []

    client.onSessionUpdate('sess_timer', (update) => observed.push(update))
    for (const update of [
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Echo current time again',
        status: 'pending',
        rawInput: { command: 'date' },
      },
      { sessionUpdate: 'usage_update', used: 13, size: 200_000 },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        title: 'Echo current time again',
        status: 'completed',
        rawOutput: '2026-08-25 21:51:03 UTC',
      },
      {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'The timer fired.' },
      },
      {
        sessionUpdate: 'usage_update',
        _meta: { '_claude/origin': { kind: 'task-notification' } },
      },
    ]) {
      h.socket().receive({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: 'sess_timer', update },
      })
    }

    expect(observed).toEqual([
      {
        kind: 'agent',
        update: {
          kind: 'tool',
          toolCallId: 'tool-1',
          title: 'Echo current time again',
          status: 'pending',
          rawInput: { command: 'date' },
        },
      },
      {
        kind: 'agent',
        update: {
          kind: 'tool',
          toolCallId: 'tool-1',
          title: 'Echo current time again',
          status: 'completed',
          rawOutput: '2026-08-25 21:51:03 UTC',
        },
      },
      { kind: 'text', text: 'The timer fired.' },
      { kind: 'complete', origin: { kind: 'task-notification' } },
    ])
  })

  test('routes Codex async-task lifecycle to the session observer during a prompt', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'ws://openab/acp',
      authKey: 'key',
      socketFactory: h.connect,
    })
    const observed: unknown[] = []

    client.onSessionUpdate('sess-task', (update) => observed.push(update))
    const prompting = client.prompt('sess-task', 'run checks', () => {})
    const request = await nextSent(h.socket(), 0)

    for (const update of [
      {
        sessionUpdate: 'async_task_spawned',
        asyncTaskId: 'task-1',
        name: 'Run checks',
        toolCallId: 'tool-1',
      },
      {
        sessionUpdate: 'async_task_state_update',
        asyncTaskId: 'task-1',
        state: 'completed',
        toolCallId: 'tool-1',
      },
    ]) {
      h.socket().receive({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: 'sess-task', update },
      })
    }
    h.socket().receive({
      jsonrpc: '2.0',
      id: request.id,
      result: { stopReason: 'end_turn' },
    })
    await prompting

    expect(observed).toEqual([
      {
        kind: 'async-task',
        asyncTaskId: 'task-1',
        phase: 'spawned',
        name: 'Run checks',
        toolCallId: 'tool-1',
      },
      {
        kind: 'async-task',
        asyncTaskId: 'task-1',
        phase: 'terminal',
        state: 'completed',
        toolCallId: 'tool-1',
      },
    ])
  })

  test('routes Codex thread status to the session observer during a prompt', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'ws://openab/acp',
      authKey: 'key',
      socketFactory: h.connect,
    })
    const observed: unknown[] = []
    const deltas: string[] = []

    client.onSessionUpdate('sess-status', (update) => observed.push(update))
    const prompting = client.prompt('sess-status', 'run a command', (text) => deltas.push(text))
    const request = await nextSent(h.socket(), 0)

    h.socket().receive({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess-status',
        update: {
          sessionUpdate: 'session_info_update',
          _meta: { codex: { threadStatus: { type: 'idle' } } },
        },
      },
    })
    h.socket().receive({
      jsonrpc: '2.0',
      id: request.id,
      result: { stopReason: 'end_turn' },
    })
    await prompting

    expect(observed).toEqual([{ kind: 'status', status: 'idle' }])
    expect(deltas).toEqual([])
  })

  test('does not wake an observed session from a late async-task completion after cancellation', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'ws://openab/acp',
      authKey: 'key',
      socketFactory: h.connect,
    })
    let observerCalls = 0

    client.onSessionUpdate('sess-cancelled-task', () => {
      observerCalls++
      void client
        .prompt('sess-cancelled-task', 'unexpected continuation', () => null)
        .catch(() => null)
    })
    client.cancel('sess-cancelled-task')
    const framesAfterCancel = h.socket().sent.length

    h.socket().receive({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess-cancelled-task',
        update: {
          sessionUpdate: 'async_task_state_update',
          asyncTaskId: 'task-late',
          state: 'completed',
          toolCallId: 'tool-late',
        },
      },
    })
    await Bun.sleep(0)

    expect(observerCalls).toBe(0)
    expect(h.socket().sent).toHaveLength(framesAfterCancel)
    client.close()
  })

  test('loads an existing session and reports a shared transport disconnect once', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'ws://openab/acp',
      authKey: 'key',
      socketFactory: h.connect,
    })
    let disconnects = 0

    client.onClosed(() => {
      disconnects++
    })
    const loading = client.loadSession('sess-existing', '/workspace')

    expect(await nextSent(h.socket(), 0)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'session/resume',
      params: {
        sessionId: 'sess-existing',
        cwd: '/workspace',
        mcpServers: [],
        _meta: { 'ai.nuphos/runtimeAuthority': 2, 'dev.openab/permissionPolicy': 'relay' },
      },
    })
    h.socket().receive({ jsonrpc: '2.0', id: 1, result: {} })
    await loading
    h.socket().fail()
    h.socket().close()

    expect(disconnects).toBe(1)
  })

  test('loadSession reports pool liveness from the resume meta', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'ws://openab/acp',
      authKey: 'key',
      socketFactory: h.connect,
    })

    // Absent meta (older gateway) → assume alive.
    const first = client.loadSession('sess-a', '/workspace')

    await nextSent(h.socket(), 0)
    h.socket().receive({ jsonrpc: '2.0', id: 1, result: {} })
    expect(await first).toEqual({ alive: true })

    // Pool reports the inner session is gone.
    const second = client.loadSession('sess-a', '/workspace')

    await nextSent(h.socket(), 1)
    h.socket().receive({
      jsonrpc: '2.0',
      id: 2,
      result: { _meta: { 'dev.openab/sessionAlive': false } },
    })
    expect(await second).toEqual({ alive: false })

    // Pool reports the inner session survived.
    const third = client.loadSession('sess-a', '/workspace')

    await nextSent(h.socket(), 2)
    h.socket().receive({
      jsonrpc: '2.0',
      id: 3,
      result: { _meta: { 'dev.openab/sessionAlive': true } },
    })
    expect(await third).toEqual({ alive: true })
  })

  test('session/new and session/load carry a declared MCP server verbatim', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'ws://openab/acp',
      authKey: 'key',
      socketFactory: h.connect,
    })
    const servers = [
      {
        name: 'nuphos-credentials',
        type: 'http' as const,
        url: 'https://backend.example/agent-sessions/conv-1/teams/team-1/mcp',
        headers: [{ name: 'Authorization', value: 'Bearer session-token' }],
      },
    ]
    const creating = client.createSession('/workspace', servers)
    const newFrame = await nextSent(h.socket(), 0)

    expect(newFrame.method).toBe('session/new')
    expect((newFrame.params as { mcpServers: unknown }).mcpServers).toEqual(servers)
    h.socket().receive({ jsonrpc: '2.0', id: newFrame.id, result: { sessionId: 'sess_mcp' } })
    expect(await creating).toBe('sess_mcp')

    const loading = client.loadSession('sess_mcp', '/workspace', servers)
    const loadFrame = await nextSent(h.socket(), 1)

    expect(loadFrame.method).toBe('session/resume')
    expect((loadFrame.params as { mcpServers: unknown }).mcpServers).toEqual(servers)
    h.socket().receive({ jsonrpc: '2.0', id: loadFrame.id, result: {} })
    await loading
  })

  test('appends the Nuphos system prompt through _meta on session/new and session/load', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'ws://openab/acp',
      authKey: 'key',
      socketFactory: h.connect,
    })
    const creating = client.createSession('/workspace', [], 'You are the Nuphos Agent.')
    const newFrame = await nextSent(h.socket(), 0)

    expect(newFrame.params).toEqual({
      cwd: '/workspace',
      mcpServers: [],
      _meta: {
        'ai.nuphos/runtimeAuthority': 2,
        'dev.openab/permissionPolicy': 'relay',
        systemPrompt: { append: 'You are the Nuphos Agent.' },
      },
    })
    h.socket().receive({ jsonrpc: '2.0', id: newFrame.id, result: { sessionId: 'sess_sp' } })
    await creating

    const loading = client.loadSession('sess_sp', '/workspace', [], 'You are the Nuphos Agent.')
    const loadFrame = await nextSent(h.socket(), 1)

    expect((loadFrame.params as { _meta: unknown })._meta).toEqual({
      'ai.nuphos/runtimeAuthority': 2,
      'dev.openab/permissionPolicy': 'relay',
      systemPrompt: { append: 'You are the Nuphos Agent.' },
    })
    h.socket().receive({ jsonrpc: '2.0', id: loadFrame.id, result: {} })
    await loading

    // Permission relay is a session-level opt-in even without a system prompt.
    const plain = client.createSession('/workspace')
    const plainFrame = await nextSent(h.socket(), 2)

    expect(plainFrame.params).toEqual({
      cwd: '/workspace',
      mcpServers: [],
      _meta: { 'ai.nuphos/runtimeAuthority': 2, 'dev.openab/permissionPolicy': 'relay' },
    })
    h.socket().receive({ jsonrpc: '2.0', id: plainFrame.id, result: { sessionId: 'sess_plain' } })
    await plain
  })

  test('returns the selected decision for a relayed OpenAB permission request', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'ws://openab/acp',
      authKey: 'key',
      socketFactory: h.connect,
    })
    const requests: unknown[] = []
    const prompting = client.prompt(
      'sess_permission',
      'patch the database',
      () => {},
      undefined,
      async (request) => {
        requests.push(request)

        return { outcome: { outcome: 'selected', optionId: 'allow-once' } }
      },
    )
    const promptFrame = await nextSent(h.socket(), 0)
    const permissionParams = {
      sessionId: 'sess_permission',
      toolCall: {
        toolCallId: 'tool-dangerous',
        title: 'Patch MongoDBCommunity',
        rawInput: { command: 'kubectl patch mongodbcommunity example' },
      },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      ],
    }

    h.socket().receive({
      jsonrpc: '2.0',
      id: 77,
      method: 'session/request_permission',
      params: permissionParams,
    })

    expect(await nextSent(h.socket(), 1)).toEqual({
      jsonrpc: '2.0',
      id: 77,
      result: { outcome: { outcome: 'selected', optionId: 'allow-once' } },
    })
    expect(requests).toEqual([permissionParams])

    h.socket().receive({
      jsonrpc: '2.0',
      id: promptFrame.id,
      result: { stopReason: 'end_turn' },
    })
    await prompting
  })

  test('accepts a permission request without the optional ACP tool title', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'ws://openab/acp',
      authKey: 'key',
      socketFactory: h.connect,
    })
    const prompt = client.prompt(
      'session-1',
      'hello',
      () => {},
      undefined,
      async (request) => {
        expect(request.toolCall.title).toBe('OpenAB tool request')

        return { outcome: { outcome: 'selected', optionId: 'allow' } }
      },
    )
    const promptFrame = await nextSent(h.socket(), 0)

    h.socket().receive({
      jsonrpc: '2.0',
      id: 88,
      method: 'session/request_permission',
      params: {
        sessionId: 'session-1',
        toolCall: { toolCallId: 'tool-1' },
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      },
    })
    expect(await nextSent(h.socket(), 1)).toEqual({
      jsonrpc: '2.0',
      id: 88,
      result: { outcome: { outcome: 'selected', optionId: 'allow' } },
    })
    h.socket().receive({
      jsonrpc: '2.0',
      id: promptFrame.id,
      result: { stopReason: 'end_turn' },
    })
    await prompt
  })

  test('answers a permission request for a runtime-started turn with no prompt pending', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'ws://openab/acp',
      authKey: 'key',
      socketFactory: h.connect,
    })
    const requests: unknown[] = []
    const stop = client.onSessionPermission('sess_autonomous', async (request) => {
      requests.push(request)

      return { outcome: { outcome: 'selected', optionId: 'allow-once' } }
    })
    const params = {
      sessionId: 'sess_autonomous',
      toolCall: { toolCallId: 'tool-wakeup', title: 'Run kubectl get pods' },
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    }

    h.socket().receive({
      jsonrpc: '2.0',
      id: 91,
      method: 'session/request_permission',
      params,
    })

    expect(await nextSent(h.socket(), 0)).toEqual({
      jsonrpc: '2.0',
      id: 91,
      result: { outcome: { outcome: 'selected', optionId: 'allow-once' } },
    })
    expect(requests).toEqual([params])

    // Unregistering restores the fail-closed behavior.
    stop()
    h.socket().receive({
      jsonrpc: '2.0',
      id: 92,
      method: 'session/request_permission',
      params,
    })
    expect(await nextSent(h.socket(), 1)).toEqual({
      jsonrpc: '2.0',
      id: 92,
      result: { outcome: { outcome: 'cancelled' } },
    })
  })

  test('an in-flight prompt keeps answering its own session permission requests', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'ws://openab/acp',
      authKey: 'key',
      socketFactory: h.connect,
    })
    let fallbackCalls = 0

    client.onSessionPermission('sess_both', async () => {
      fallbackCalls++

      return { outcome: { outcome: 'cancelled' } }
    })
    const prompting = client.prompt(
      'sess_both',
      'do the thing',
      () => {},
      undefined,
      async () => ({ outcome: { outcome: 'selected', optionId: 'allow-prompt' } }),
    )
    const promptFrame = await nextSent(h.socket(), 0)

    h.socket().receive({
      jsonrpc: '2.0',
      id: 93,
      method: 'session/request_permission',
      params: {
        sessionId: 'sess_both',
        toolCall: { toolCallId: 'tool-1', title: 'Run kubectl get pods' },
        options: [{ optionId: 'allow-prompt', name: 'Allow once', kind: 'allow_once' }],
      },
    })

    expect(await nextSent(h.socket(), 1)).toEqual({
      jsonrpc: '2.0',
      id: 93,
      result: { outcome: { outcome: 'selected', optionId: 'allow-prompt' } },
    })
    expect(fallbackCalls).toBe(0)

    h.socket().receive({ jsonrpc: '2.0', id: promptFrame.id, result: { stopReason: 'end_turn' } })
    await prompting
  })

  test('passes session-scoped environment through Claude Code metadata', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'ws://openab/acp',
      authKey: 'key',
      socketFactory: h.connect,
    })
    const runtime = {
      env: { NUPHOS_PLAN_API_BASE: 'http://backend/plans', NUPHOS_PLAN_API_TOKEN: 'scoped' },
    }
    const creating = client.createSession('/workspace', [], undefined, runtime)
    const frame = await nextSent(h.socket(), 0)

    expect((frame.params as { _meta: unknown })._meta).toEqual({
      'ai.nuphos/runtimeAuthority': 2,
      'dev.openab/permissionPolicy': 'relay',
      'dev.openab/credentials': { NUPHOS_PLAN_API_TOKEN: 'scoped' },
      claudeCode: { options: { env: runtime.env } },
    })
    h.socket().receive({ jsonrpc: '2.0', id: frame.id, result: { sessionId: 'sess_native' } })
    await creating
  })

  test('re-presents the current session context and credentials on every prompt', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'ws://openab/acp',
      authKey: 'key',
      socketFactory: h.connect,
    })
    const mcpServers = [
      {
        name: 'nuphos-tools',
        type: 'http' as const,
        url: 'http://backend/mcp-tools',
        headers: [{ name: 'Authorization', value: 'Bearer turn-2' }],
      },
    ]
    const runtime = {
      provider: 'codex' as const,
      env: { NUPHOS_TOKEN: 'turn-2', NUPHOS_PLAN_API_TOKEN: 'turn-2', TEAM: 'team' },
    }
    const prompting = client.prompt(
      's',
      'hi',
      () => {},
      undefined,
      undefined,
      () => {},
      {
        mcpServers,
        systemPrompt: 'Instructions',
        runtime,
      },
    )
    const frame = await nextSent(h.socket(), 0)
    const meta = (frame.params as { _meta: Record<string, unknown> })._meta

    expect(meta['ai.nuphos/acknowledgePrompt']).toBe(true)
    expect(meta['dev.openab/mcpServers']).toEqual(mcpServers)
    expect(meta['dev.openab/sessionMeta']).toEqual({
      'ai.nuphos/runtimeAuthority': 2,
      'dev.openab/permissionPolicy': 'relay',
      'dev.openab/credentials': { NUPHOS_TOKEN: 'turn-2', NUPHOS_PLAN_API_TOKEN: 'turn-2' },
      'ai.nuphos/codex': { developerInstructions: 'Instructions', env: runtime.env },
    })
    h.socket().receive({ jsonrpc: '2.0', id: frame.id, result: { stopReason: 'end_turn' } })
    await prompting

    const bare = client.prompt('s', 'hi', () => {})
    const bareFrame = await nextSent(h.socket(), 1)

    expect((bareFrame.params as Record<string, unknown>)._meta).toBeUndefined()
    h.socket().receive({ jsonrpc: '2.0', id: bareFrame.id, result: { stopReason: 'end_turn' } })
    await bare
  })

  test('sends cancel as an ACP notification', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'ws://openab/acp',
      authKey: 'key',
      socketFactory: h.connect,
    })

    client.cancel('sess_openab')

    expect(await nextSent(h.socket(), 0)).toEqual({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: 'sess_openab' },
    })
  })

  test('cancel waits for the runtime prompt response and keeps its final updates', async () => {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'ws://openab/acp',
      authKey: 'key',
      socketFactory: h.connect,
      promptTimeoutMs: 100,
    })
    const observed: unknown[] = []
    const deltas: string[] = []

    client.onSessionUpdate('sess_openab', (update) => observed.push(update))
    const prompting = client.prompt('sess_openab', 'keep working', (text) => deltas.push(text))
    let settled = false

    void prompting.finally(() => {
      settled = true
    })

    const promptFrame = await nextSent(h.socket(), 0)

    client.cancel('sess_openab')

    await Promise.resolve()
    expect(settled).toBe(false)
    h.socket().receive({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess_openab',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'late output' },
        },
      },
    })
    h.socket().receive({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 'sess_openab', update: { sessionUpdate: 'usage_update' } },
    })
    h.socket().receive({
      jsonrpc: '2.0',
      id: promptFrame.id,
      result: { stopReason: 'cancelled' },
    })

    expect(await prompting).toEqual({ stopReason: 'cancelled' })
    expect(deltas).toEqual(['late output'])
    expect(observed).toEqual([])
  })
})

test('terminal runtime errors fence late tool updates until a new prompt', async () => {
  const h = harness()
  const client = await OpenAbAcpClient.connect({
    url: 'ws://openab/acp',
    authKey: 'key',
    socketFactory: h.connect,
  })
  const observed: unknown[] = []
  const deltas: string[] = []

  client.onSessionUpdate('failed-session', (update) => observed.push(update))
  client.onSessionUpdate('other-session', (update) => observed.push(update))
  const sendUpdate = (sessionId: string, update: Record<string, unknown>) =>
    h.socket().receive({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId, update },
    })
  const outcome = client.prompt('failed-session', 'work', (text) => deltas.push(text))
  const request = await nextSent(h.socket(), 0)

  sendUpdate('failed-session', {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'Partial work' },
  })
  h.socket().receive({
    jsonrpc: '2.0',
    id: request.id,
    error: { code: -32603, message: 'ENOSPC: no space left on device' },
  })
  // Deliver synchronously, before the rejected promise's catch runs.
  const lateTool = { sessionUpdate: 'tool_call_update', toolCallId: 'old-tool', status: 'failed' }

  sendUpdate('failed-session', lateTool)
  sendUpdate('failed-session', {
    sessionUpdate: 'usage_update',
    _meta: { '_claude/origin': { kind: 'task-notification' } },
  })
  sendUpdate('failed-session', lateTool)
  await expect(outcome).rejects.toThrow('ENOSPC')
  expect(deltas).toEqual(['Partial work'])
  expect(observed).toEqual([])
  sendUpdate('other-session', {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'Other work' },
  })
  expect(observed).toHaveLength(1)
  const resumed = client.prompt('failed-session', 'retry', (text) => deltas.push(text))
  const retry = await nextSent(h.socket(), 1)

  sendUpdate('failed-session', {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'Recovered' },
  })
  h.socket().receive({ jsonrpc: '2.0', id: retry.id, result: { stopReason: 'end_turn' } })
  await resumed
  expect(deltas).toEqual(['Partial work', 'Recovered'])
  client.close()
})

test('evicted failed sessions release fences without delivering late updates', async () => {
  const h = harness()
  const client = await OpenAbAcpClient.connect({
    url: 'ws://openab/acp',
    authKey: 'key',
    socketFactory: h.connect,
  })
  const observed: unknown[] = []
  const sendText = (sessionId: string) =>
    h.socket().receive({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'late output' },
        },
      },
    })

  client.onSessionUpdate('healthy', (update) => observed.push(update))
  for (let index = 0; index < 20; index++) {
    const sessionId = `failed-${String(index)}`
    const stop = client.onSessionUpdate(sessionId, (update) => observed.push(update))
    const stopSecond = client.onSessionUpdate(sessionId, (update) => observed.push(update))
    const sentIndex = h.socket().sent.length
    const outcome = client.prompt(sessionId, 'work', () => {})
    const request = await nextSent(h.socket(), sentIndex)

    h.socket().receive({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32603, message: 'ENOSPC' },
    })
    await expect(outcome).rejects.toThrow('ENOSPC')
    stop()
    sendText(sessionId)
    expect((Reflect.get(client, 'cancelledSessions') as Set<string>).size).toBe(1)
    stopSecond()
    client.cancel(sessionId)
    sendText(sessionId)
    expect((Reflect.get(client, 'cancelledSessions') as Set<string>).size).toBe(0)
  }
  expect(observed).toEqual([])
  const stopOld = client.onSessionUpdate('replacement', (update) => observed.push(update))

  stopOld()
  const stopNew = client.onSessionUpdate('replacement', (update) => observed.push(update))

  client.cancel('replacement')
  stopOld()
  sendText('replacement')
  expect(observed).toEqual([])
  expect((Reflect.get(client, 'cancelledSessions') as Set<string>).size).toBe(1)
  stopNew()
  sendText('healthy')
  expect(observed).toHaveLength(1)
  client.cancel('healthy')
  client.close()
  expect((Reflect.get(client, 'cancelledSessions') as Set<string>).size).toBe(0)
})

test('unobserved prompt failures do not retain cancellation fences', async () => {
  const h = harness()
  const client = await OpenAbAcpClient.connect({
    url: 'ws://openab/acp',
    authKey: 'key',
    socketFactory: h.connect,
  })
  const outcome = client.prompt('unobserved', 'work', () => {})
  const request = await nextSent(h.socket(), 0)

  h.socket().receive({
    jsonrpc: '2.0',
    id: request.id,
    error: { code: -32603, message: 'ENOSPC' },
  })
  await expect(outcome).rejects.toThrow('ENOSPC')
  expect((Reflect.get(client, 'cancelledSessions') as Set<string>).size).toBe(0)
  client.close()
})

test('configuration calls address the stored session without resuming or cancelling it', async () => {
  const h = harness()
  const client = await OpenAbAcpClient.connect({
    url: 'wss://openab.example/acp',
    authKey: 'key',
    socketFactory: h.connect,
    callTimeoutMs: 15,
  })
  const read = client.getSessionConfigOptions('existing-session')
  const request = await nextSent(h.socket(), 0)

  expect(request).toMatchObject({
    method: '_openab/session/config_options',
    params: { sessionId: 'existing-session' },
  })
  h.socket().receive({ jsonrpc: '2.0', id: request.id, result: { configOptions: [] } })
  expect(await read).toEqual({ configOptions: [] })
  const write = client.setSessionConfigOption('existing-session', 'model', 'b')

  await expect(write).rejects.toThrow('timed out')
  expect(h.socket().sent.map((frame) => JSON.parse(frame).method)).toEqual([
    '_openab/session/config_options',
    'session/set_config_option',
  ])
  expect(h.socket().closeCalls).toBe(0)
  client.close()
})

test('both providers forward runtime defaults with the session-scoped environment', async () => {
  for (const provider of ['claude-code', 'codex'] as const) {
    const h = harness()
    const client = await OpenAbAcpClient.connect({
      url: 'ws://openab/acp',
      authKey: 'key',
      socketFactory: h.connect,
    })
    const defaults = { model: 'model-b', fast: 'off' as const, effort: 'high' }
    const creating = client.createSession('/workspace', [], 'Instructions', {
      provider,
      defaults,
      env: { NUPHOS_TOKEN: 'scoped' },
    })
    const frame = await nextSent(h.socket(), 0)
    const meta = (frame.params as { _meta: Record<string, unknown> })._meta

    expect(meta['ai.nuphos/runtimeDefaults']).toEqual(defaults)
    expect(meta['dev.openab/permissionPolicy']).toBe('relay')
    expect(JSON.stringify(meta)).toContain('scoped')
    h.socket().receive({ jsonrpc: '2.0', id: frame.id, result: { sessionId: 'sess_native' } })
    await creating
    client.close()
  }
})

test('disconnect explicitly interrupts observed runtime turns without pending prompts', async () => {
  const h = harness()
  const client = await OpenAbAcpClient.connect({
    url: 'ws://openab/acp',
    authKey: 'key',
    socketFactory: h.connect,
  })
  const observed: unknown[] = []

  client.onSessionUpdate('autonomous', (update) => {
    observed.push(update)
  })
  h.socket().fail()
  h.socket().close()
  expect(observed).toEqual([{ kind: 'interrupted', reason: 'runtime_connection_lost' }])
})

test('reads a runtime execution snapshot without restoring or taking over its output', async () => {
  const h = harness()
  const client = await OpenAbAcpClient.connect({
    url: 'ws://runtime/acp',
    authKey: 'test',
    socketFactory: h.connect,
  })
  const read = client.getSessionExecutionState('session-live-on-another-replica')
  const request = await nextSent(h.socket(), 0)

  expect(request.method).toBe('_openab/session/state')
  expect(request.params).toEqual({ sessionId: 'session-live-on-another-replica' })
  h.socket().receive({
    jsonrpc: '2.0',
    id: request.id,
    result: { epoch: 'runtime-1', revision: 9, state: 'idle' },
  })
  expect(await read).toEqual({ epoch: 'runtime-1', revision: 9, state: 'idle' })
  expect(h.socket().sent).toHaveLength(1)
  client.close()
})

test('runtime admission acknowledges one overlapping prompt and routes its output only to that owner', async () => {
  const h = harness()
  const client = await OpenAbAcpClient.connect({
    url: 'ws://openab/acp',
    authKey: 'key',
    socketFactory: h.connect,
  })
  const firstText: string[] = []
  const secondText: string[] = []
  let firstAccepted = 0
  let secondAccepted = 0
  const first = client.prompt(
    's',
    'first',
    (text) => firstText.push(text),
    undefined,
    undefined,
    () => {
      firstAccepted++
    },
  )
  const second = client.prompt(
    's',
    'second',
    (text) => secondText.push(text),
    undefined,
    undefined,
    () => {
      secondAccepted++
    },
  )
  const rejected = second.catch((error: unknown) => error)
  const firstRequest = await nextSent(h.socket(), 0)
  const secondRequest = await nextSent(h.socket(), 1)

  h.socket().receive({
    jsonrpc: '2.0',
    method: '_openab/session/prompt_accepted',
    params: { sessionId: 's', requestId: firstRequest.id },
  })
  h.socket().receive({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 's',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Owned output' },
      },
    },
  })
  h.socket().receive({
    jsonrpc: '2.0',
    id: secondRequest.id,
    error: { code: -32001, message: 'Runtime session is busy' },
  })
  h.socket().receive({ jsonrpc: '2.0', id: firstRequest.id, result: { stopReason: 'end_turn' } })
  await first
  expect(await rejected).toMatchObject({ message: 'Runtime session is busy' })
  expect(firstAccepted).toBe(1)
  expect(secondAccepted).toBe(0)
  expect(firstText).toEqual(['Owned output'])
  expect(secondText).toEqual([])
  expect(h.socket().sent.some((frame) => JSON.parse(frame).method === 'session/cancel')).toBe(false)
  client.close()
})

test('an unacknowledged prompt timeout cannot cancel another accepted command', async () => {
  const h = harness()
  const client = await OpenAbAcpClient.connect({
    url: 'ws://fixture/acp',
    authKey: 'fixture',
    socketFactory: h.connect,
    promptTimeoutMs: 20,
  })

  await expect(
    client.prompt(
      'session-a',
      'pending',
      () => {},
      undefined,
      undefined,
      () => {},
    ),
  ).rejects.toThrow('timed out')
  expect(h.socket().sent.some((frame) => JSON.parse(frame).method === 'session/cancel')).toBe(false)
  client.close()
})

test('steering uses the control method without attaching or prompting a session', async () => {
  const h = harness()
  const client = await OpenAbAcpClient.connect({
    url: 'ws://runtime.invalid/acp',
    authKey: 'operator',
    socketFactory: h.connect,
  })
  const pending = client.steerSession('session', 'Focus on tests', 'receipt')
  const frame = await nextSent(h.socket(), 0)

  expect(frame.method).toBe('_openab/session/steer')
  expect(frame.params).toEqual({
    sessionId: 'session',
    prompt: [{ type: 'text', text: 'Focus on tests' }],
    messageId: 'receipt',
  })
  h.socket().receive({ jsonrpc: '2.0', id: frame.id, result: { outcome: 'injected' } })
  expect(await pending).toEqual({ outcome: 'injected' })
  expect(h.socket().sent).toHaveLength(1)
  client.close()
})

test('sends native local file references alongside text to a fresh runtime session', async () => {
  const h = harness()
  const client = await OpenAbAcpClient.connect({
    url: 'ws://openab/acp',
    authKey: 'key',
    socketFactory: h.connect,
  })
  const images = [
    {
      type: 'resource_link' as const,
      mimeType: 'image/png',
      uri: 'file:///tmp/screen.png',
      name: 'screen.png',
    },
  ]
  const prompting = client.prompt(
    'fresh',
    'Read this screenshot',
    () => {},
    undefined,
    undefined,
    undefined,
    undefined,
    images,
  )
  const request = await nextSent(h.socket(), 0)

  expect(request).toMatchObject({
    method: 'session/prompt',
    params: {
      sessionId: 'fresh',
      prompt: [{ type: 'text', text: 'Read this screenshot' }, ...images],
    },
  })
  h.socket().receive({ jsonrpc: '2.0', id: request.id, result: { stopReason: 'end_turn' } })
  await prompting
  client.close()
})

test('a closed transport rejects in-flight calls with the close reason', async () => {
  const h = harness()
  const client = await OpenAbAcpClient.connect({
    url: 'ws://openab/acp',
    authKey: 'key',
    socketFactory: h.connect,
  })
  const call = client.initialize()

  h.socket().reject(1006, 'The computer running this agent is offline')
  await expect(call).rejects.toThrow(
    'OpenAB ACP connection closed: The computer running this agent is offline',
  )
})
