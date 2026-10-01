import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

type ServerRow = { activitySeq: number; readSeq: number }

const server = new Map<string, ServerRow>()
const posted: [string, number][] = []
const fetched: string[] = []
let failPosts = false

const row = (sessionId: string) => ({ sessionId, teamId: 'team', ...server.get(sessionId) })

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    api: {
      agentMarkConversationRead: (sessionId: string, seq: number) => {
        posted.push([sessionId, seq])
        if (failPosts) return Promise.reject(new Error('offline'))
        const current = server.get(sessionId)!

        current.readSeq = Math.max(current.readSeq, Math.min(seq, current.activitySeq))

        return Promise.resolve({ ...current, unread: current.activitySeq > current.readSeq })
      },
      agentGetConversation: (sessionId: string) => {
        fetched.push(sessionId)

        return Promise.resolve(row(sessionId))
      },
    },
  },
})
mock.module('react', {
  namedExports: {
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  },
})

const {
  receiveConversationReadStates,
  refreshSessionReader,
  registerSessionReader,
  useAgentUnreadSessions,
} = await import('./agentUnreadSessions.ts')
const { observeTurnUnread } = await import('../components/agent/panel/turnUnread.ts')

const unread = (...ids: string[]) => ids.filter((id) => useAgentUnreadSessions().has(id))
const settle = () => new Promise((resolve) => setImmediate(resolve))
const listPoll = (...ids: string[]) => receiveConversationReadStates(ids.map(row))
const transcriptFetch = (id: string) => receiveConversationReadStates([row(id)], true)

test('the server marker drives the badge, and a read on another device clears it', () => {
  server.set('a', { activitySeq: 2, readSeq: 1 })
  server.set('legacy', { activitySeq: 0, readSeq: 0 })
  receiveConversationReadStates([{ sessionId: 'no-marker' }])
  listPoll('a', 'legacy')
  assert.deepEqual(unread('a', 'legacy', 'no-marker'), ['a'])

  server.get('a')!.readSeq = 2
  listPoll('a')
  assert.deepEqual(unread('a'), [])

  receiveConversationReadStates([{ sessionId: 'a', activitySeq: 2, readSeq: 1 }])
  assert.deepEqual(unread('a'), [], 'a stale response cannot move the marker back')

  server.get('a')!.activitySeq = 3
  listPoll('a')
  assert.deepEqual(unread('a'), ['a'], 'new assistant activity after the marker is unread again')
})

test('an on-screen view marks read only what it has fetched with the transcript', async () => {
  server.set('viewed', { activitySeq: 1, readSeq: 0 })
  listPoll('viewed')
  const close = registerSessionReader('viewed', () => true)

  assert.deepEqual(unread('viewed'), [], 'the conversation on screen never shows its own badge')
  assert.deepEqual(posted, [], 'nothing displayed yet, nothing marked')

  transcriptFetch('viewed')
  await settle()
  assert.deepEqual(posted, [['viewed', 1]])

  server.get('viewed')!.activitySeq = 2
  listPoll('viewed')
  await settle()
  assert.deepEqual(posted, [['viewed', 1]], 'a list row is not a displayed turn')

  transcriptFetch('viewed')
  await settle()
  assert.deepEqual(posted.at(-1), ['viewed', 2])
  assert.equal(server.get('viewed')!.readSeq, 2)
  close()
  assert.deepEqual(unread('viewed'), [])
})

test('an unfocused view marks read once it regains focus', async () => {
  let focused = false

  server.set('focus', { activitySeq: 4, readSeq: 3 })
  const close = registerSessionReader('focus', () => focused)

  transcriptFetch('focus')
  await settle()
  assert.deepEqual(unread('focus'), ['focus'])
  assert.equal(server.get('focus')!.readSeq, 3)

  focused = true
  refreshSessionReader('focus')
  await settle()
  assert.equal(server.get('focus')!.readSeq, 4)
  assert.deepEqual(unread('focus'), [])
  close()
})

test('a failed read is retried by the next transcript fetch', async () => {
  server.set('retry', { activitySeq: 1, readSeq: 0 })
  const close = registerSessionReader('retry', () => true)

  failPosts = true
  transcriptFetch('retry')
  await settle()
  failPosts = false
  close()
  assert.deepEqual(
    unread('retry'),
    ['retry'],
    'the badge reflects the server again after the failure',
  )

  const reopen = registerSessionReader('retry', () => true)

  transcriptFetch('retry')
  await settle()
  assert.equal(server.get('retry')!.readSeq, 1)
  reopen()
})

test('a turn boundary refreshes an on-screen conversation right away', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  server.set('live', { activitySeq: 0, readSeq: 0 })
  listPoll('live')
  const close = registerSessionReader('live', () => true)

  observeTurnUnread('live', { type: 'sse', data: { type: 'runtime-state' } })
  observeTurnUnread('live', { type: 'end' })
  server.get('live')!.activitySeq = 1
  observeTurnUnread('live', { type: 'sse', data: { type: 'atlas-turn-complete' } })
  observeTurnUnread('elsewhere', { type: 'sse', data: { type: 'atlas-turn-paused' } })
  mock.timers.tick(1_000)
  mock.timers.reset()
  await settle()
  await settle()
  assert.deepEqual(fetched, ['live'])
  assert.equal(server.get('live')!.readSeq, 1)
  close()
})
