import { expect, test } from 'bun:test'

import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'

import { conversationExecutionState, probeExecutionState } from './session-execution-state'

import type { AgentConversation } from '@/lib/agent/db'

let endpoint = ''

useRuntimeRegistry({
  resolveTeamRuntimeEndpoints: () =>
    Promise.resolve([{ url: endpoint, authKey: 'operator-fixture' }]),
})

test('legacy conversation state follows its OpenAB placement and permits a follow-up', async () => {
  const methods: string[] = []
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return

      return new Response('upgrade required', { status: 400 })
    },
    websocket: {
      message(ws, data) {
        const frame = JSON.parse(String(data))

        methods.push(frame.method)
        const result =
          frame.method === 'initialize'
            ? { protocolVersion: 1 }
            : {
                schemaVersion: 2,
                epoch: 'runtime',
                revision: 1,
                state: 'idle',
                phase: 'idle',
                label: 'Ready',
                tools: [],
                actions: { send: true, cancel: false, steer: false },
              }

        ws.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }))
      },
    },
  })

  endpoint = `ws://127.0.0.1:${server.port}/acp`
  try {
    const snapshot = await conversationExecutionState({
      sessionId: 'legacy',
      teamId: 'team',
      agentRuntime: 'claude-code',
    } as AgentConversation)

    expect(snapshot.schemaVersion).toBe(2)
    expect(snapshot.actions?.send).toBe(true)
    expect(methods).toEqual(['initialize', '_openab/session/state'])
  } finally {
    await server.stop(true)
  }
})

test('a continuation parked on a lost output connection accepts the prompt that reattaches it', async () => {
  // The runtime reports send:false, and only a prompt reattaches the session;
  // a client waiting for send:true would wait forever.
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return

      return new Response('upgrade required', { status: 400 })
    },
    websocket: {
      message(ws, data) {
        const frame = JSON.parse(String(data))
        const result =
          frame.method === 'initialize'
            ? { protocolVersion: 1 }
            : {
                schemaVersion: 2,
                epoch: 'runtime',
                revision: 4,
                state: 'active',
                phase: 'resume_disconnected',
                label: 'Automatic continuation paused: output connection lost',
                tools: [],
                actions: { send: false, cancel: true, steer: false },
              }

        ws.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }))
      },
    },
  })

  endpoint = `ws://127.0.0.1:${server.port}/acp`
  try {
    const snapshot = await conversationExecutionState({
      sessionId: 'parked',
      teamId: 'team',
      agentRuntime: 'claude-code',
    } as AgentConversation)

    expect(snapshot.phase).toBe('resume_disconnected')
    expect(snapshot.actions).toEqual({ send: true, cancel: true, steer: false })
  } finally {
    await server.stop(true)
  }
})

test('a moved conversation reports a startable agent, not a lost connection', async () => {
  // The move clears the attachment, so there is no session to probe: probing
  // anyway reported 'disconnected', which parks a queued message on "waiting for
  // the agent to be ready" that only a prompt could clear.
  const snapshot = await conversationExecutionState({
    sessionId: 'moved',
    teamId: 'team',
    agentRuntime: 'codex',
    runtimeMigration: {
      mode: 'history',
      toRuntimeId: 'new',
      movedAt: new Date(),
      movedBy: 'owner',
    },
  } as unknown as AgentConversation)

  expect(snapshot.state).toBe('dormant')
  expect(snapshot.schemaVersion).toBe(2)
  expect(snapshot.actions?.send).toBe(true)
})

test('a conversation moved before the fix is read the same way', async () => {
  // Those docs still carry the attachment the old move wrote, with a session id
  // the runtime never issued. Treating it as live is the 500 all over again.
  const snapshot = await conversationExecutionState({
    sessionId: 'moved-legacy',
    teamId: 'team',
    agentRuntime: 'codex',
    claudeCodePreview: {
      runtimeUrl: 'ws://unreachable.invalid/acp',
      openabSessionId: '0bea5c6c-7ece-4767-bed3-1845e43767e2',
      forceNew: true,
    },
    runtimeMigration: {
      mode: 'history',
      toRuntimeId: 'new',
      movedAt: new Date(),
      movedBy: 'owner',
    },
  } as unknown as AgentConversation)

  expect(snapshot.state).toBe('dormant')
  expect(snapshot.actions?.send).toBe(true)
})

for (const [failure, message] of [
  ['timeout', 'OpenAB ACP _openab/session/state timed out'],
  ['invalid snapshot', 'Invalid runtime execution snapshot'],
  ['unsupported RPC', 'Method not found'],
] as const) {
  test(`admission preserves ${failure} while status readers retain their fallback`, async () => {
    const methods: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request, socketServer) {
        if (socketServer.upgrade(request)) return

        return new Response('upgrade required', { status: 400 })
      },
      websocket: {
        message(ws, data) {
          const frame = JSON.parse(String(data))

          methods.push(frame.method)
          if (frame.method === 'initialize') {
            ws.send(
              JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { protocolVersion: 1 } }),
            )
          } else if (failure === 'unsupported RPC') {
            ws.send(
              JSON.stringify({
                jsonrpc: '2.0',
                id: frame.id,
                error: { code: -32601, message: 'Method not found' },
              }),
            )
          } else if (failure === 'invalid snapshot') {
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { state: 'idle' } }))
          }
          // timeout: the runtime is connected, but never answers the state query.
        },
      },
    })

    endpoint = `ws://127.0.0.1:${String(server.port)}/acp`
    const conversation = {
      sessionId: 'probe-failure',
      teamId: 'team',
      agentRuntime: 'claude-code',
    } as AgentConversation

    try {
      await expect(probeExecutionState(conversation)).rejects.toThrow(message)
      expect(await conversationExecutionState(conversation)).toEqual({
        state: failure === 'unsupported RPC' ? 'unsupported' : 'disconnected',
      })
      expect(methods).toEqual([
        'initialize',
        '_openab/session/state',
        'initialize',
        '_openab/session/state',
      ])
    } finally {
      await server.stop(true)
    }
  }, 10_000)
}

test('admission waits out a slow socket open that status readers give up on', async () => {
  // A computer's tunnel can take a few seconds to open a stream. A status read
  // falls back to 'disconnected' and is asked again; admission decides whether a
  // turn runs at all, so it must not lose the turn to the same delay.
  const server = Bun.serve({
    port: 0,
    async fetch(request, socketServer) {
      await Bun.sleep(4_000)
      if (socketServer.upgrade(request)) return

      return new Response('upgrade required', { status: 400 })
    },
    websocket: {
      message(ws, data) {
        const frame = JSON.parse(String(data))
        const result =
          frame.method === 'initialize'
            ? { protocolVersion: 1 }
            : {
                schemaVersion: 2,
                epoch: 'runtime',
                revision: 1,
                state: 'idle',
                phase: 'idle',
                label: 'Ready',
                tools: [],
                actions: { send: true, cancel: false, steer: false },
              }

        ws.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }))
      },
    },
  })

  endpoint = `ws://127.0.0.1:${String(server.port)}/acp`
  const conversation = {
    sessionId: 'slow-open',
    teamId: 'team',
    agentRuntime: 'claude-code',
  } as AgentConversation

  try {
    expect((await probeExecutionState(conversation)).actions?.send).toBe(true)
    expect(await conversationExecutionState(conversation)).toEqual({ state: 'disconnected' })
  } finally {
    await server.stop(true)
  }
}, 20_000)
