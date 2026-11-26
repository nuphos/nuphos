import { expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'
import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'

import { conversationExecutionState, probeExecutionState } from './session-execution-state'

import type { AgentConversation } from '@/lib/agent/db'

let endpoint = ''
let refusal: Error | undefined

useRuntimeRegistry({
  resolveTeamRuntimeEndpoints: () =>
    refusal
      ? Promise.reject(refusal)
      : Promise.resolve([{ url: endpoint, authKey: 'operator-fixture' }]),
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

test('a new Bot with no native session is startable before its first Task message', async () => {
  const snapshot = await probeExecutionState({
    sessionId: 'new-bot',
    teamId: 'team',
    userId: 'owner',
    agentRuntime: 'codex',
    messageCount: 0,
  })

  expect(snapshot.state).toBe('dormant')
  expect(snapshot.phase).toBe('dormant')
  expect(snapshot.actions?.send).toBe(true)
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
      toRuntimeId: 'new',
      movedAt: new Date(),
      movedBy: 'owner',
    },
  } as unknown as AgentConversation)

  expect(snapshot.state).toBe('dormant')
  expect(snapshot.schemaVersion).toBe(2)
  // Clients hide resting phases; without one they fall back to printing a status.
  expect(snapshot.phase).toBe('dormant')
  expect(snapshot.label).toBeUndefined()
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
      toRuntimeId: 'new',
      movedAt: new Date(),
      movedBy: 'owner',
    },
  } as unknown as AgentConversation)

  expect(snapshot.state).toBe('dormant')
  expect(snapshot.actions?.send).toBe(true)
})

// A queued send read as disconnected waits for the computer to reconnect, then says it did not:
// an agent refused for a reason of its own is not reconnecting, and its send meets that reason.
for (const [failure, state] of [
  [new AppError(409, 'runtime_not_installed', 'Claude Code is too old to run here.'), 'dormant'],
  [new AppError(409, 'runtime_disabled', 'This conversation’s agent is disabled.'), 'dormant'],
  [new AppError(409, 'claude_code_setup_required', 'Add a runtime first.'), 'dormant'],
  [
    new AppError(409, 'runtime_offline', 'The computer running this agent is offline.'),
    'disconnected',
  ],
  [
    new AppError(503, 'claude_code_runtime_unavailable', 'The attached agent is unavailable.'),
    'disconnected',
  ],
] as const) {
  test(`an agent refused with ${failure.code} reads as ${state}`, async () => {
    refusal = failure
    const conversation = {
      sessionId: failure.code,
      teamId: 'team',
      agentRuntime: 'claude-code',
    } as AgentConversation

    try {
      await expect(probeExecutionState(conversation)).rejects.toThrow(failure.message)
      expect((await conversationExecutionState(conversation)).state).toBe(state)
    } finally {
      refusal = undefined
    }
  })
}

// A state query that is only slow is not a failure for admission: it waits, and
// the two tests below cover it. These are answers the runtime did give.
for (const [failure, message] of [
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
          } else {
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { state: 'idle' } }))
          }
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

test('admission waits out a slow state answer that status readers give up on', async () => {
  // The same delay on the call rather than the open: a tunnel that has just
  // reconnected is slow over its first round trip too, and admission losing the
  // turn there costs the same.
  const server = Bun.serve({
    port: 0,
    fetch(request, socketServer) {
      if (socketServer.upgrade(request)) return

      return new Response('upgrade required', { status: 400 })
    },
    websocket: {
      async message(ws, data) {
        const frame = JSON.parse(String(data))

        if (frame.method === 'initialize') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { protocolVersion: 1 } }))

          return
        }
        await Bun.sleep(4_000)
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: frame.id,
            result: {
              schemaVersion: 2,
              epoch: 'runtime',
              revision: 1,
              state: 'idle',
              phase: 'idle',
              label: 'Ready',
              tools: [],
              actions: { send: true, cancel: false, steer: false },
            },
          }),
        )
      },
    },
  })

  endpoint = `ws://127.0.0.1:${String(server.port)}/acp`
  const conversation = {
    sessionId: 'slow-answer',
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
