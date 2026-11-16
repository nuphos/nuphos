import { afterAll, expect, spyOn, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

import { registry, sessionsByConversation } from './agent-chat-registry'
import { runClaudeCodePreviewPrompt } from './agent-chat-runtime'
import { OpenAbAcpClient } from './openab-acp-client'

import type { ConversationPreviewAttachment } from '@/lib/agent/db/shared'
import type { AcpSocket } from './openab-acp-session'

type Frame = { id?: number; method?: string; params?: Record<string, unknown> }

/**
 * A runtime before 0.1.62 over a real WebSocket. Its agent has lost `sess_1`, and the runtime
 * keeps prompting it: every prompt there gets the wire error a v0.1.61 runtime sent in
 * production. A session opened since works.
 */
const sessions = new Set(['sess_1'])
const lost = new Set(['sess_1'])
const prompted: string[] = []
const gateway = Bun.serve({
  port: 0,
  fetch: (req, server) => (server.upgrade(req) ? undefined : new Response(null, { status: 400 })),
  websocket: {
    message(ws, raw) {
      const frame = JSON.parse(String(raw)) as Frame
      const reply = (body: Record<string, unknown>) =>
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, ...body }))
      const sessionId = typeof frame.params?.sessionId === 'string' ? frame.params.sessionId : ''

      if (typeof frame.id !== 'number') return
      if (frame.method === 'initialize')
        return reply({ result: { protocolVersion: 1, agentCapabilities: {} } })
      if (frame.method === 'session/new') {
        const id = `sess_${String(sessions.size + 1)}`

        sessions.add(id)

        return reply({ result: { sessionId: id } })
      }
      if (frame.method === 'session/resume') return reply({ result: {} })
      if (frame.method !== 'session/prompt')
        return reply({ error: { code: -32601, message: 'Method not found' } })
      prompted.push(sessionId)
      if (lost.has(sessionId))
        return reply({
          error: {
            code: -32603,
            message: '**Internal Error** (code: -32603)\nInternal error\n> Session not found',
            data: { code: -32603, message: 'Internal error' },
          },
        })
      reply({ result: { stopReason: 'end_turn' } })
    },
  },
})

afterAll(() => gateway.stop(true))

const endpoint = {
  url: `ws://127.0.0.1:${String(gateway.port)}/acp`,
  authKey: 'fixture',
  provider: 'claude-code' as const,
}
let stored: ConversationPreviewAttachment | null = {
  openabSessionId: 'sess_1',
  runtimeUrl: endpoint.url,
}

useAgentDb({
  getConversationPreviewAttachment: async () => stored,
  setConversationPreviewAttachment: async (_id: string, _team: string, next) => {
    stored = next
  },
  // Mongo's filter: only the session that was lost.
  forgetConversationPreviewSession: async (_id: string, _team: string, sessionId: string) => {
    if (stored?.openabSessionId === sessionId) stored = null
  },
  consumeConversationRetracted: async () => false,
  consumeConversationWorkLost: async () => null,
  markConversationWorkLost: async () => {},
})
useDb({ db: () => ({ collection: () => ({ findOne: async () => null }) }) })
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
  sessionsByConversation.delete('team:conversation')
})

const send = (text: string) =>
  runClaudeCodePreviewPrompt({
    teamId: 'team',
    conversationId: 'conversation',
    userId: 'user',
    locale: 'en-US',
    message: '',
    text,
    endpoint,
    signal: new AbortController().signal,
    onTextDelta: () => {},
  })

test('after "Session not found" the next message opens a new session and goes through', async () => {
  await expect(send('first')).rejects.toThrow('Session not found')
  expect(await send('again')).toMatchObject({ stopReason: 'end_turn' })
  expect(prompted).toEqual(['sess_1', 'sess_2'])
  expect(stored?.openabSessionId).toBe('sess_2')
})
