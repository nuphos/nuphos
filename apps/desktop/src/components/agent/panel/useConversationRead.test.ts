import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

let activeContext: { isActive: boolean } | null = null
let cleanup: (() => void) | undefined
let focused = true
let visibilityState = 'visible'
const windowEvents = new EventTarget()
const documentEvents = new EventTarget()
const server = new Map<string, { activitySeq: number; readSeq: number }>()

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: Object.assign(windowEvents, {
    api: {
      agentMarkConversationRead: (sessionId: string, seq: number) => {
        const current = server.get(sessionId)!

        current.readSeq = Math.max(current.readSeq, seq)

        return Promise.resolve({ ...current, unread: false })
      },
    },
  }),
})
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: Object.assign(documentEvents, {
    hasFocus: () => focused,
  }),
})
Object.defineProperty(documentEvents, 'visibilityState', { get: () => visibilityState })
// Mock React's scheduling only; run the real read store and effect lifecycle.
mock.module('react', {
  namedExports: {
    createContext: () => ({}),
    useContext: () => activeContext,
    useEffect: (effect: () => (() => void) | undefined) => {
      cleanup = effect()
    },
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  },
})
const { useConversationRead } = await import('./useConversationRead.ts')
const { receiveConversationReadStates, useAgentUnreadSessions } =
  await import('../../../lib/agentUnreadSessions.ts')

const settle = () => new Promise((resolve) => setImmediate(resolve))
const isUnread = (id: string) => [id].some((key) => useAgentUnreadSessions().has(key))

/** Another device's turn landed, and this device fetched the transcript that shows it. */
function newTurn(id: string) {
  const current = server.get(id) ?? { activitySeq: 0, readSeq: 0 }

  current.activitySeq += 1
  server.set(id, current)
  receiveConversationReadStates([{ sessionId: id, ...current }], true)
}

function reset() {
  cleanup?.()
  cleanup = undefined
  activeContext = null
  focused = true
  visibilityState = 'visible'
}

test('the permanent main pane marks read without a workspace tab provider', async () => {
  reset()
  newTurn('main')
  assert.equal(isUnread('main'), true)
  useConversationRead('main', true)
  await settle()
  assert.equal(isUnread('main'), false)
  assert.equal(server.get('main')!.readSeq, 1)
  newTurn('main')
  await settle()
  assert.equal(server.get('main')!.readSeq, 2)
  cleanup?.()
  newTurn('main')
  assert.equal(isUnread('main'), true)
})

test('inactive workspace tabs and collapsed panels leave it unread', async () => {
  reset()
  activeContext = { isActive: false }
  newTurn('inactive')
  useConversationRead('inactive', true)
  activeContext = null
  useConversationRead('inactive', false)
  await settle()
  assert.equal(isUnread('inactive'), true)
  useConversationRead('inactive', true)
  await settle()
  assert.equal(isUnread('inactive'), false)
  assert.equal(server.get('inactive')!.readSeq, 1)
})

test('returning focus marks read without a streaming transition', async () => {
  reset()
  focused = false
  newTurn('return')
  useConversationRead('return', true)
  await settle()
  assert.equal(isUnread('return'), true)
  focused = true
  windowEvents.dispatchEvent(new Event('focus'))
  await settle()
  assert.equal(isUnread('return'), false)
  assert.equal(server.get('return')!.readSeq, 1)
  reset()
})

test('a hidden document keeps it unread until it becomes visible again', async () => {
  reset()
  visibilityState = 'hidden'
  useConversationRead('hidden', true)
  newTurn('hidden')
  await settle()
  assert.equal(isUnread('hidden'), true)
  visibilityState = 'visible'
  documentEvents.dispatchEvent(new Event('visibilitychange'))
  await settle()
  assert.equal(isUnread('hidden'), false)
  reset()
})
