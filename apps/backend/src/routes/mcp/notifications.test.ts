import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useIdentity } from '@/lib/test/doubles/identity'
import { usePendingQueue } from '@/lib/test/doubles/pending-queue'

let readable = false
let report: { id: string; status: 'done'; summary: string; at: Date } | undefined

useIdentity({
  authenticateToken: async () => ({ user: { id: '111111111111111111111111' } }) as never,
})
useAgentRunStore({ getActiveAgentRunForSession: async () => null })
usePendingQueue({ queuedAnswers: async () => new Map() })
useAgentDb({
  getReadableConversation: async () =>
    readable
      ? ({
          sessionId: 'task',
          userId: '111111111111111111111111',
          teamId: '222222222222222222222222',
          messageCount: 2,
          taskReport: report,
        } as never)
      : null,
  getLatestAssistantMessage: async () =>
    ({ index: 1, role: 'assistant', parts: [{ type: 'text', text: 'Saved answer' }] }) as never,
})
const { mcp } = await import('../mcp')

beforeEach(() => {
  readable = false
  report = undefined
})
test('a subscription requires the same MCP bearer authentication', async () => {
  expect((await mcp.request('/?session_id=task')).status).toBe(401)
})
test('generic MCP GET without a subscription stays unsupported', async () => {
  expect((await mcp.request('/', { headers: { authorization: 'Bearer test' } })).status).toBe(405)
})
test('private, missing or revoked sessions cannot subscribe', async () => {
  expect(
    (await mcp.request('/?session_id=task', { headers: { authorization: 'Bearer test' } })).status,
  ).toBe(404)
})

test('a stored answer is replayable with the same stable id after reconnect', async () => {
  readable = true
  const { sessionNotification } = await import('./notifications')
  const first = await sessionNotification('task', '111111111111111111111111')
  const second = await sessionNotification('task', '111111111111111111111111')

  expect(first?.id).toBe(second?.id)
  expect(first?.notification.params).toMatchObject({ status: 'completed', answer: 'Saved answer' })
  report = { id: 'report', status: 'done', summary: 'Verified', at: new Date('2026-01-01') }
  const reported = await sessionNotification('task', '111111111111111111111111')

  expect(reported?.id).not.toBe(first?.id)
  expect(reported?.notification.params.task_report).toMatchObject({ id: 'report', status: 'done' })
})

test('SSE sends a JSON-RPC notification with a resumable id', async () => {
  readable = true
  const response = await mcp.request('/?session_id=task', {
    headers: { authorization: 'Bearer test' },
  })

  expect(response.headers.get('content-type')).toContain('text/event-stream')
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let data = ''

  while (!data.includes('notifications/nuphos/session')) {
    const next = await reader.read()

    if (next.done) throw new Error('subscription closed before the snapshot')
    data += decoder.decode(next.value)
  }
  await reader.cancel()
  expect(data).toContain('retry: 1000')
  expect(data).toMatch(/id: [a-f0-9]{64}/)
  expect(data).toContain('Saved answer')
})

test('an invalid reconnect cursor is rejected before streaming', async () => {
  readable = true
  const response = await mcp.request('/?session_id=task', {
    headers: { authorization: 'Bearer test', 'Last-Event-ID': 'invalid' },
  })

  expect(response.status).toBe(400)
})
