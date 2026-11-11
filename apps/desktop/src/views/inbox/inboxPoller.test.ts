import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

const timers = new Map<number, number>()
let nextTimer = 0
let loads = 0

globalThis.setInterval = ((_load: () => void, ms: number) => {
  timers.set(++nextTimer, ms)

  return nextTimer
}) as unknown as typeof setInterval
globalThis.clearInterval = ((id: number) => timers.delete(id)) as typeof clearInterval
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { addEventListener: () => {}, removeEventListener: () => {} },
})
mock.module('../../api.ts', {
  namedExports: {
    api: {
      agentListConversations: async () => {
        loads += 1

        return { conversations: [], nextCursor: null }
      },
    },
  },
})
// Each call is one screen mounting; the returned cleanup unmounts it.
let mounted: (() => void) | undefined

mock.module('react', {
  namedExports: {
    useEffect: (effect: () => (() => void) | undefined) => {
      mounted = effect()
    },
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  },
})

const { useInboxListing } = await import('./useInbox.ts')

function mount(pollMs: number, teamId = 'team'): () => void {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Test harness drives the hook's lifecycle.
  useInboxListing(teamId, pollMs)

  assert.ok(mounted)

  return mounted
}

test("every screen reading a team's listing shares one poller, at the fastest rate any asks for", () => {
  const badge = mount(15_000)
  const inbox = mount(5_000)
  const task = mount(5_000)

  assert.deepEqual([...timers.values()], [5_000])
  // Each screen opening loads a fresh listing once.
  assert.equal(loads, 3)
  inbox()
  task()
  assert.deepEqual([...timers.values()], [15_000])
  badge()
  assert.equal(timers.size, 0)
})

test('a split pane on another team gets its own poller, which neither starves', () => {
  loads = 0
  const badge = mount(15_000)
  const other = mount(5_000, 'other-team')

  assert.deepEqual([...timers.values()].sort(), [15_000, 5_000].sort())
  assert.equal(loads, 2)
  other()
  assert.deepEqual([...timers.values()], [15_000])
  badge()
  assert.equal(timers.size, 0)
})
