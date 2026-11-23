import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useIdentity } from '@/lib/test/doubles/identity'
import { usePendingQueue } from '@/lib/test/doubles/pending-queue'

let readable = false
let report: { id: string; status: 'done'; summary: string; at: Date } | undefined
let parentSessionId: string | undefined

useIdentity({
  authenticateToken: async () => ({ user: { id: '111111111111111111111111' } }),
})
useAgentRunStore({ getActiveAgentRunForSession: async () => null })
usePendingQueue({ queuedAnswers: async () => new Map() })
useAgentDb({
  getReadableConversation: async () =>
    readable
      ? {
          sessionId: 'task',
          userId: '111111111111111111111111',
          teamId: '222222222222222222222222',
          messageCount: 2,
          taskReport: report,
          ...(parentSessionId ? { parentSessionId } : {}),
        }
      : null,
  getLatestAssistantMessage: async () => ({
    index: 1,
    role: 'assistant',
    parts: [{ type: 'text', text: 'Saved answer' }],
  }),
})
const { mcp } = await import('../mcp')

beforeEach(() => {
  readable = false
  report = undefined
  parentSessionId = undefined
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

// #4747: an endpoint that started a session learns which of its events come from its Tasks.
test('a Task names the session above it', async () => {
  readable = true
  const { sessionNotification } = await import('./notifications')

  expect(
    (await sessionNotification('task', '111111111111111111111111'))?.notification.params,
  ).not.toHaveProperty('parent_session_id')
  parentSessionId = 'coordinator'
  expect(
    (await sessionNotification('task', '111111111111111111111111'))?.notification.params,
  ).toMatchObject({ parent_session_id: 'coordinator' })
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

test('concurrent subscriptions share a per-user bound and disconnect releases a slot', async () => {
  readable = true
  const { MCP_SUBSCRIPTION_LIMIT } = await import('./subscription-limit')
  const headers = { authorization: 'Bearer test' }
  const responses = await Promise.all(
    Array.from({ length: MCP_SUBSCRIPTION_LIMIT }, () =>
      mcp.request('/?session_id=task', { headers }),
    ),
  )
  const readers = responses.map((response) => response.body!.getReader())

  expect(responses.every((response) => response.status === 200)).toBe(true)
  // Another token for the same authenticated user cannot create a second pool.
  const rejected = await mcp.request('/?session_id=task', {
    headers: { authorization: 'Bearer another-token' },
  })

  expect(rejected.status).toBe(429)
  expect(rejected.headers.get('retry-after')).toBe('5')
  await Promise.all(
    readers.map(async (reader) => {
      await reader.read()
    }),
  )
  await readers[0]!.cancel()
  const next = await mcp.request('/?session_id=task', { headers })

  expect(next.status).toBe(200)
  const nextReader = next.body!.getReader()

  await nextReader.read()
  await Promise.all([nextReader.cancel(), ...readers.slice(1).map((reader) => reader.cancel())])
})

test('one user cannot use another user’s subscription slots', async () => {
  const { admitMcpSubscription, MCP_SUBSCRIPTION_LIMIT } = await import('./subscription-limit')
  const first = await Promise.all(
    Array.from({ length: MCP_SUBSCRIPTION_LIMIT }, () => admitMcpSubscription('limit-user-a')),
  )
  const other = await admitMcpSubscription('limit-user-b')

  expect(await admitMcpSubscription('limit-user-a')).toBe('limited')
  expect(typeof other).toBe('object')
  for (const slot of [...first, other]) if (typeof slot === 'object') await slot.release()
})

test('revoking access closes a stream and releases its subscription slot', async () => {
  readable = true
  const headers = { authorization: 'Bearer test' }
  const response = await mcp.request('/?session_id=task', { headers })
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let data = ''

  while (!data.includes('notifications/nuphos/session')) {
    const chunk = await reader.read()

    if (chunk.done) throw new Error('subscription closed before its initial event')
    data += decoder.decode(chunk.value)
  }
  readable = false
  while (!data.includes('access_revoked')) {
    const chunk = await reader.read()

    if (chunk.done) throw new Error('subscription closed without revocation notice')
    data += decoder.decode(chunk.value)
  }
  await reader.read()
  readable = true
  const { MCP_SUBSCRIPTION_LIMIT } = await import('./subscription-limit')
  const again = await Promise.all(
    Array.from({ length: MCP_SUBSCRIPTION_LIMIT }, () =>
      mcp.request('/?session_id=task', { headers }),
    ),
  )

  expect(again.every((item) => item.status === 200)).toBe(true)
  const readers = again.map((item) => item.body!.getReader())

  await Promise.all(readers.map((item) => item.read()))
  await Promise.all(readers.map((item) => item.cancel()))
})
