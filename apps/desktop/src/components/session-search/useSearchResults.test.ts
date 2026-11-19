import assert from 'node:assert/strict'
import { beforeEach, afterEach, mock, test } from 'node:test'

let slots: unknown[] = []
let index = 0
let dependencies: unknown[] | undefined
let cleanup: (() => void) | undefined
let request: (options: { cursor?: string }) => Promise<unknown>
const members = async () => []

mock.module('../../api.ts', {
  namedExports: {
    api: {
      agentListConversations: (_team: string, options: { cursor?: string }) => request(options),
    },
    parseAtlasError: (error: { code?: string }) => ({ code: error.code }),
  },
})
let visits: { sessionId: string; openedAt: number }[] = []
let forgotten: string[] = []

mock.module('../../lib/sessionHistory.ts', {
  namedExports: {
    readSessionHistory: () => visits,
    forgetSessionVisits: (_user: string, _team: string, ids: string[]) => forgotten.push(...ids),
  },
})
mock.module('react', {
  namedExports: {
    useState: (initial: unknown) => {
      const slot = index++

      if (!(slot in slots)) slots[slot] = initial

      return [
        slots[slot],
        (value: unknown) => {
          slots[slot] = typeof value === 'function' ? value(slots[slot]) : value
        },
      ]
    },
    useRef: (initial: unknown) => {
      const slot = index++

      if (!(slot in slots)) slots[slot] = { current: initial }

      return slots[slot]
    },
    useEffect: (effect: () => () => void, next: unknown[]) => {
      if (dependencies && next.every((value, at) => Object.is(value, dependencies![at]))) return
      cleanup?.()
      dependencies = next
      cleanup = effect()
    },
  },
})
const { useSearchResults } = await import('./useSearchResults.ts')

function render(query = 'deploy') {
  index = 0

  // eslint-disable-next-line react-hooks/rules-of-hooks -- Run the real hook with a deterministic effect scheduler.
  return useSearchResults('team', 'user', 'sessions', query, members)
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
const page = (ids: string[], nextCursor: string | null = null) => ({
  conversations: ids.map((sessionId) => ({ sessionId })),
  nextCursor,
  hasMore: Boolean(nextCursor),
})

beforeEach(() => {
  visits = []
  forgotten = []
  slots = []
  dependencies = undefined
  cleanup = undefined
})
afterEach(() => cleanup?.())

test('pagination deduplicates sessions and retries the failed cursor without losing earlier rows', async () => {
  let fail = true
  const cursors: (string | undefined)[] = []

  request = async ({ cursor }) => {
    cursors.push(cursor)
    if (!cursor) return page(['a', 'b'], 'next')
    if (fail) throw new Error('offline')

    return page(['b', 'c'])
  }
  render()
  await flush()
  await render().loadMore()
  assert.equal(render().error, true)
  assert.deepEqual(
    render().sessions.map((item) => item.conversation.sessionId),
    ['a', 'b'],
  )
  fail = false
  render().retry()
  await flush()
  assert.deepEqual(
    render().sessions.map((item) => item.conversation.sessionId),
    ['a', 'b', 'c'],
  )
  assert.equal(render().hasMore, false)
  assert.deepEqual(cursors, [undefined, 'next', 'next'])
})

test('an obsolete query cannot install its response after unmount', async () => {
  let finish!: (value: unknown) => void

  request = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  render()
  cleanup?.()
  finish(page(['obsolete']))
  await flush()
  assert.deepEqual(render().sessions, [])
})

test('a failed initial request can be retried and empty results finish loading', async () => {
  request = async () => {
    throw new Error('offline')
  }
  render()
  await flush()
  assert.equal(render().error, true)
  request = async () => page([])
  render().retry()
  render()
  await flush()
  assert.equal(render().error, false)
  assert.equal(render().loading, false)
  assert.deepEqual(render().sessions, [])
})

test('a recent chat that is gone or no longer yours leaves the history, so it is not asked for again', async () => {
  visits = ['kept', 'deleted', 'left', 'offline'].map((sessionId, openedAt) => ({
    sessionId,
    openedAt,
  }))
  const failures: Record<string, string | undefined> = {
    deleted: 'not_found',
    left: 'forbidden',
    offline: undefined,
  }
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      api: {
        agentGetConversation: async (sessionId: string) => {
          if (!(sessionId in failures)) return { sessionId }
          throw Object.assign(new Error('refused'), { code: failures[sessionId] })
        },
      },
    },
  })
  try {
    render('')
    await flush()
    assert.deepEqual(
      render('').sessions.map((result) => result.conversation.sessionId),
      ['kept'],
    )
    // A temporary failure keeps its visit.
    assert.deepEqual(forgotten, ['deleted', 'left'])
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
