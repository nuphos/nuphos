import { expect, test } from 'bun:test'

import { conversationExecutionState } from './session-execution-state'

import type { AgentConversation } from '@/lib/agent/db'

import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'

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
