import { afterAll, expect, spyOn, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useDb } from '@/lib/test/doubles/db'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

import { registry, sessionsByConversation } from './agent-chat-registry'
import { runClaudeCodePreviewPrompt } from './agent-chat-runtime'
import { startConversationFresh } from './conversation-fresh-start'
import { OpenAbAcpClient } from './openab-acp-client'
import { previewHistoryPreamble } from './preview-history-preamble'
import { previewCompaction } from './preview-transcript'

import type { AgentConversation, AgentMessage } from '@/lib/agent/db'
import type { ConversationPreviewAttachment } from '@/lib/agent/db/shared'
import type { UIMessage } from 'ai'

type Frame = { id?: number; method?: string; params?: Record<string, unknown> }

/** A runtime over a real WebSocket that holds `sess_1`, and records every prompt by session. */
const opened: string[] = []
const prompts: { sessionId: string; text: string }[] = []
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
      if (frame.method === 'session/new') {
        const id = `sess_${String(opened.length + 2)}`

        opened.push(id)

        return reply({ result: { sessionId: id } })
      }
      if (frame.method === 'session/resume') return reply({ result: {} })
      if (frame.method !== 'session/prompt')
        return reply({ error: { code: -32601, message: 'Method not found' } })
      const parts = (frame.params?.prompt ?? []) as { type: string; text?: string }[]

      prompts.push({
        sessionId: String(frame.params?.sessionId),
        text: parts.map((part) => part.text ?? '').join('\n'),
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
const said = (index: number, role: 'user' | 'assistant', text: string) =>
  ({ messageId: `m${String(index)}`, index, role, parts: [{ type: 'text', text }] }) as AgentMessage
// Six messages before the Replace point; the oldest is one the new session must not read.
const stored: AgentMessage[] = [
  said(0, 'user', 'OLDEST: set up the staging cluster'),
  said(1, 'assistant', 'Staging is up'),
  said(2, 'user', 'Rotate the keys'),
  said(3, 'assistant', 'Rotated'),
  said(4, 'user', 'LATEST: check the deploy'),
  said(5, 'assistant', 'The deploy is green'),
]
let attachment: ConversationPreviewAttachment | null = {
  openabSessionId: 'sess_1',
  runtimeUrl: endpoint.url,
}
let compaction: { summary: string; messageCount: number } | null = null

useAgentDb({
  getConversationPreviewAttachment: async () => attachment,
  setConversationPreviewAttachment: async (_id, _team, next) => {
    attachment = next
  },
  forgetConversationPreviewSession: async (_id, _team, sessionId) => {
    if (attachment?.openabSessionId === sessionId) attachment = null
  },
  getConversationMessages: async (_id, _user, options) => stored.slice(-(options?.tail ?? 0)),
  updateCompactionSummary: async (_id, _user, summary, messageCount) => {
    compaction = { summary, messageCount }
  },
  getCompactionSummary: async () => compaction,
  compactedMessageIds: async (_id, _user, ids, messageCount) =>
    new Set(ids.filter((id) => stored.some((m) => m.messageId === id && m.index < messageCount))),
  recordBotStartedFresh: async () => {},
  recordAgentEvent: () => {},
  consumeConversationRetracted: async () => false,
  consumeConversationWorkLost: async () => null,
  markConversationWorkLost: async () => {},
})
useAgentRunStore({
  getActiveAgentRunForSession: async () => null,
  reserveActiveAgentRunForSession: async () => async () => {},
})
useDb({ db: () => ({ collection: () => ({ findOne: async () => null }) }) })
useSessionExecutionState({
  probeExecutionState: async () => ({ schemaVersion: 2, actions: { send: true } }),
})

const client = await OpenAbAcpClient.connect({
  ...endpoint,
  socketFactory: () => new WebSocket(endpoint.url, ['acp.v1']),
})

spyOn(registry, 'acquire').mockResolvedValue(client)
afterAll(() => {
  client.close()
  sessionsByConversation.delete('team:bot')
})

const asUi = (message: AgentMessage) =>
  ({ id: message.messageId, role: message.role, parts: message.parts }) as UIMessage

/** One turn, prompted as preparePreviewTurn prompts it: the history preamble for a new session. */
async function send(text: string) {
  const messages = [...stored.map(asUi), { id: text, role: 'user', parts: [] } as UIMessage]
  const history = await previewCompaction(
    'bot',
    'owner',
    messages.map((m) => m.id),
  )

  return runClaudeCodePreviewPrompt({
    teamId: 'team',
    conversationId: 'bot',
    userId: 'owner',
    locale: 'en-US',
    message: '',
    text,
    endpoint,
    signal: new AbortController().signal,
    onTextDelta: () => {},
    freshSessionMessage: (uncertain) => previewHistoryPreamble(messages, history, uncertain) ?? '',
  })
}

test('the turn after Replace runs on a new session that reads only a summary of before', async () => {
  await send('before')
  expect(prompts.at(-1)?.sessionId).toBe('sess_1')

  await startConversationFresh(
    { sessionId: 'bot', userId: 'owner', teamId: 'team', title: 'Scout' } as AgentConversation & {
      teamId: string
    },
    'owner',
  )
  expect(attachment).toBeNull()
  await send('after')

  const fresh = prompts.at(-1)

  expect(opened).toEqual(['sess_2'])
  expect(fresh?.sessionId).toBe('sess_2')
  expect(attachment?.openabSessionId).toBe('sess_2')
  expect(fresh?.text).toContain('none of your messages before #6')
  expect(fresh?.text).toContain('LATEST: check the deploy')
  expect(fresh?.text).not.toContain('OLDEST')
  // Nothing was said since the Replace point, so no turn follows the summary.
  expect(fresh?.text).not.toContain('Recent turns:')
})
