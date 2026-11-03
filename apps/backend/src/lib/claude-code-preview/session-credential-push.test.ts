import { afterAll, expect, test } from 'bun:test'

import { useConversationChatRoute } from '@/lib/test/doubles/conversation-chat-route'

import { OpenAbAcpClient } from './openab-acp-client'
import { OpenAbRpcError } from './openab-acp-errors'
import { pushSessionCredentials } from './session-credential-push'
import { renewTurnCredentials } from './turn-credential-renewal'

import type { CredentialPushTarget } from './session-credential-push'

const TRANSPORT_KEY = 'transport-fixture'
const CONTROL_KEY = 'control-fixture'
const SESSION = 'sess_173201f5-7973-4186-ae78-e63c2988d1b9'

let advertise = true
const received: { key: string; params: Record<string, unknown> }[] = []

// Answers like OpenAB's ACP gateway: `_openab/session/credentials` is a
// runtime-control method, refused on a transport connection.
const runtime = Bun.serve<{ key: string }>({
  port: 0,
  fetch(request, server) {
    const protocols = request.headers.get('sec-websocket-protocol') ?? ''
    const key = /openab\.bearer\.([^,\s]+)/u.exec(protocols)?.[1] ?? ''

    if (server.upgrade(request, { data: { key } })) return

    return new Response('upgrade required', { status: 400 })
  },
  websocket: {
    message(ws, data) {
      const frame = JSON.parse(String(data))
      const reply = (body: Record<string, unknown>) => {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, ...body }))
      }

      if (frame.method === 'initialize') {
        reply({
          result: {
            protocolVersion: 1,
            agentCapabilities: { _meta: { 'dev.openab/credentialRefresh': advertise } },
          },
        })
      } else if (ws.data.key === CONTROL_KEY) {
        received.push({ key: ws.data.key, params: frame.params })
        reply({ result: {} })
      } else {
        reply({ error: { code: -32003, message: 'Runtime operator credential required' } })
      }
    },
  },
})
const url = `ws://127.0.0.1:${String(runtime.port)}/acp`

const purposes: string[] = []

useConversationChatRoute({
  resolveConversationChatRuntime: (_teamId, _conversation, request = {}) => {
    const purpose = request.purpose ?? 'transport'

    purposes.push(purpose)

    return Promise.resolve({
      runtime: 'claude-code',
      endpoint: { url, authKey: purpose === 'control' ? CONTROL_KEY : TRANSPORT_KEY },
    })
  },
})

afterAll(async () => {
  await runtime.stop(true)
})

const target: CredentialPushTarget = {
  teamId: 'team',
  conversationId: 'conversation',
  userId: 'owner',
  provider: 'claude-code',
  runtimeId: 'runtime',
  runtimeUrl: url,
  openabSessionId: SESSION,
}

test('the runtime refuses a credential renewal on the turn transport connection', async () => {
  // This is how #657 renewed, and why every renewal failed until #919 reverted it.
  const transport = await OpenAbAcpClient.connect({ url, authKey: TRANSPORT_KEY })

  try {
    await transport.initialize()
    const refused = await transport
      .refreshCredentials(SESSION, { NUPHOS_TOKEN: 'turn' }, { NUPHOS_TOKEN: 'renewed' })
      .catch((error: unknown) => error)

    expect(refused).toBeInstanceOf(OpenAbRpcError)
    expect((refused as OpenAbRpcError).code).toBe(-32003)
  } finally {
    transport.close()
  }
})

test('turn renewals reach the runtime over a control connection, each naming the last', async () => {
  received.length = 0
  advertise = true
  let minted = 0
  const renewal = renewTurnCredentials({
    installed: { NUPHOS_TOKEN: 'turn', NUPHOS_PLAN_API_TOKEN: 'turn', OTHER: 'kept-local' },
    mint: () => {
      minted++

      return { NUPHOS_TOKEN: `renewed-${String(minted)}` }
    },
    push: (expected, next) => pushSessionCredentials(target, expected, next),
    intervalMs: 5,
  })

  for (let waited = 0; received.length < 2 && waited < 1_000; waited += 5) await Bun.sleep(5)
  renewal.stop()
  await renewal.settled()

  expect(purposes.every((purpose) => purpose === 'control')).toBe(true)
  expect(received.every((entry) => entry.key === CONTROL_KEY)).toBe(true)
  expect(received[0]?.params).toEqual({
    sessionId: SESSION,
    expected: { NUPHOS_TOKEN: 'turn', NUPHOS_PLAN_API_TOKEN: 'turn' },
    credentials: { NUPHOS_TOKEN: 'renewed-1' },
  })
  expect(received[1]?.params.expected).toEqual({ NUPHOS_TOKEN: 'renewed-1' })
})

test('renewal stops for a runtime that cannot take credentials mid-turn', async () => {
  received.length = 0
  advertise = false
  let pushes = 0
  const renewal = renewTurnCredentials({
    installed: { NUPHOS_TOKEN: 'turn' },
    mint: () => ({ NUPHOS_TOKEN: 'renewed' }),
    push: async (expected, next) => {
      pushes++

      return pushSessionCredentials(target, expected, next)
    },
    intervalMs: 5,
  })

  await Bun.sleep(60)
  await renewal.settled()
  renewal.stop()
  expect(pushes).toBe(1)
  expect(received).toEqual([])
})

test('a renewal never goes to a runtime other than the one the turn runs on', async () => {
  received.length = 0
  await expect(
    pushSessionCredentials({ ...target, runtimeUrl: 'ws://moved.invalid/acp' }, {}, {}),
  ).rejects.toThrow('Conversation runtime changed')
  expect(received).toEqual([])
})

test('renewals run one at a time; a failed push keeps the previous expectation', async () => {
  const expected: (string | undefined)[] = []
  let inFlight = 0
  let attempt = 0
  const renewal = renewTurnCredentials({
    installed: { NUPHOS_TOKEN: 'turn' },
    mint: () => ({ NUPHOS_TOKEN: `next-${String(++attempt)}` }),
    push: async (current) => {
      expect(++inFlight).toBe(1)
      expected.push(current?.NUPHOS_TOKEN)
      await Bun.sleep(8)
      inFlight--
      if (attempt === 1) throw new Error('Session credentials changed since this refresh')

      return true
    },
    intervalMs: 2,
  })

  while (expected.length < 3) await Bun.sleep(2)
  renewal.stop()
  await renewal.settled()
  expect(expected.slice(0, 3)).toEqual(['turn', 'turn', 'next-2'])
})
