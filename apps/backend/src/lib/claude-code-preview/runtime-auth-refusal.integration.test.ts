import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

import { registry, sessionsByConversation } from './agent-chat-registry'
import { runClaudeCodePreviewPrompt } from './agent-chat-runtime'
import { OpenAbAcpClient } from './openab-acp-client'
import { authRefusedRuntimes, forgetAuthRefusal } from './runtime-auth-refusal'

import { nudgeDeps } from '@/lib/agent/sign-in-request'
import { unavailableReason } from '@/lib/agent/thread-runtime'

import type { ConversationPreviewAttachment } from '@/lib/agent/db/shared'
import type { AcpSocket } from './openab-acp-session'

type Frame = { id?: number; method?: string; params?: Record<string, unknown> }
type WireError = { code: number; message: string; data?: { code: number; message: string } }

// The errors a runtime from v0.1.50 on sends, the adapter's own error under the gateway's -32603.
const wrapped = (code: number, message: string, notice = ''): WireError => ({
  code: -32603,
  message: [
    `**Internal Error** (code: ${String(code)})`,
    message,
    ...(notice ? [`> ${notice}`] : []),
  ].join('\n'),
  data: { code, message },
})
const AUTH_REQUIRED = wrapped(-32000, 'Authentication required')
const CODEX_REFRESH_EXPIRED = wrapped(
  -32603,
  'Internal error',
  'Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again.',
)

/** A made-up runtime over a real WebSocket: `refuse` names the method that fails, and how. */
let refuse: { method: string; error: WireError } | null = null
const refused: string[] = []
const gateway = Bun.serve({
  port: 0,
  fetch: (req, server) => (server.upgrade(req) ? undefined : new Response(null, { status: 400 })),
  websocket: {
    message(ws, raw) {
      const frame = JSON.parse(String(raw)) as Frame
      const reply = (body: Record<string, unknown>) => {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, ...body }))
      }

      if (typeof frame.id !== 'number') return
      if (frame.method === 'initialize')
        return reply({ result: { protocolVersion: 1, agentCapabilities: {} } })
      if (refuse && refuse.method === frame.method) {
        refused.push(refuse.method)

        return reply({ error: refuse.error })
      }
      if (frame.method === 'session/new') return reply({ result: { sessionId: 'sess_test' } })
      if (frame.method === 'session/resume') return reply({ result: {} })
      if (frame.method === 'session/prompt') return reply({ result: { stopReason: 'end_turn' } })
      reply({ error: { code: -32601, message: 'Method not found' } })
    },
  },
})

afterAll(() => gateway.stop(true))

const TEAM = 'team-test'
const RUNTIME = 'local:user-test:device-test:codex'
const OTHER = 'local:user-test:device-test:claude-code'
const endpoint = {
  url: `ws://127.0.0.1:${String(gateway.port)}/acp`,
  authKey: 'fixture',
  provider: 'codex' as const,
  runtimeId: RUNTIME,
}
let stored: ConversationPreviewAttachment | null = null

useAgentDb({
  getConversationPreviewAttachment: async () => stored,
  setConversationPreviewAttachment: async (_id: string, _team: string, next) => {
    stored = next
  },
  forgetConversationPreviewSession: async () => {
    stored = null
  },
  consumeConversationRetracted: async () => false,
  consumeConversationWorkLost: async () => null,
  markConversationWorkLost: async () => {},
})

type Row = { teamId: string; runtimeId: string }
const refusals: Row[] = []
const refusalCollection = {
  updateOne: async (filter: Row) => {
    if (!refusals.some((row) => row.runtimeId === filter.runtimeId)) refusals.push({ ...filter })
  },
  deleteOne: async (filter: Row) => {
    const at = refusals.findIndex((row) => row.runtimeId === filter.runtimeId)

    if (at >= 0) refusals.splice(at, 1)
  },
  find: (filter: { teamId: string }) => ({
    toArray: async () => refusals.filter((row) => row.teamId === filter.teamId),
  }),
}

useDb({
  db: () => ({
    collection: (name: string) =>
      name === 'runtime_auth_refusals' ? refusalCollection : { findOne: async () => null },
  }),
})
useSessionExecutionState({
  probeExecutionState: async () => ({ schemaVersion: 2, actions: { send: true } }),
})

const client = await OpenAbAcpClient.connect({
  ...endpoint,
  socketFactory: () => new WebSocket(endpoint.url, ['acp.v1']) as unknown as AcpSocket,
})

spyOn(registry, 'acquire').mockResolvedValue(client)
afterAll(() => {
  client.close()
  sessionsByConversation.delete(`${TEAM}:conversation`)
})

// Context delivered long ago makes an open session load again (session/resume).
const send = () => {
  const open = sessionsByConversation.get(`${TEAM}:conversation`)

  if (open) open.contextDeliveredAt = 0

  return runClaudeCodePreviewPrompt({
    teamId: TEAM,
    conversationId: 'conversation',
    userId: 'user-test',
    locale: 'en-US',
    message: '',
    text: 'hello',
    endpoint,
    signal: new AbortController().signal,
    onTextDelta: () => {},
  })
}
const signedInComputer = (provider: 'codex' | 'claude-code') => ({
  provider,
  local: {
    ownerUserId: 'user-test',
    deviceId: 'device-test',
    deviceLabel: 'Test computer',
    online: true,
    signedIn: true,
  },
})
const ready = async (runtimeId: string, provider: 'codex' | 'claude-code') =>
  !unavailableReason(signedInComputer(provider), (await authRefusedRuntimes(TEAM)).has(runtimeId))

beforeEach(() => {
  refuse = null
  refusals.length = 0
})

const stages = [
  ['session/new', 'opening the session', AUTH_REQUIRED],
  ['session/resume', 'loading the session', AUTH_REQUIRED],
  ['session/prompt', 'the prompt', CODEX_REFRESH_EXPIRED],
] as const

for (const [method, stage, error] of stages)
  test(`a refused sign-in at ${stage} marks only that agent, and a turn that runs clears it`, async () => {
    // session/resume needs a session already open; session/new needs none.
    if (method === 'session/new') {
      stored = null
      sessionsByConversation.delete(`${TEAM}:conversation`)
    } else await send()
    expect(await ready(RUNTIME, 'codex')).toBe(true)

    refuse = { method, error }
    await expect(send()).rejects.toThrow()
    expect(refused.at(-1)).toBe(method)
    expect(await ready(RUNTIME, 'codex')).toBe(false)
    expect(await ready(OTHER, 'claude-code')).toBe(true)
    expect(await nudgeDeps.signedIn(TEAM, RUNTIME, 'user-test')).toBe(false)

    refuse = null
    expect(await send()).toMatchObject({ stopReason: 'end_turn' })
    expect(await ready(RUNTIME, 'codex')).toBe(true)
  })

test('a completed sign-in clears it without a turn', async () => {
  refuse = { method: 'session/prompt', error: CODEX_REFRESH_EXPIRED }
  await expect(send()).rejects.toThrow()
  expect(await ready(RUNTIME, 'codex')).toBe(false)

  await forgetAuthRefusal(TEAM, RUNTIME)
  expect(await ready(RUNTIME, 'codex')).toBe(true)
})

test('a generic -32000 or a usage limit from the runtime marks nothing', async () => {
  for (const error of [
    wrapped(-32000, 'Internal server error'),
    wrapped(-32603, 'Internal error', 'You’ve hit your usage limit.'),
  ]) {
    refuse = { method: 'session/prompt', error }
    await expect(send()).rejects.toThrow()
  }

  expect(refusals).toEqual([])
})
