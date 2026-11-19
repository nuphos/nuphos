import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

let cleanup: (() => void) | undefined
let reads = 0
let settleRead: () => void = () => {}
let listed = false
const asked: unknown[] = []

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: Object.assign(new EventTarget(), {
    setInterval: () => 0,
    clearInterval: () => {},
  }),
})
// Mock React's scheduling and the API only; run the real poll.
mock.module('react', {
  namedExports: {
    useEffect: (effect: () => (() => void) | undefined) => {
      cleanup = effect()
    },
    useRef: <T>(current: T) => ({ current }),
    useSyncExternalStore: () => undefined,
  },
})
mock.module('../../../api.ts', {
  namedExports: {
    api: {
      agentGetConversation: (_id: string, _team: string, options: unknown) => {
        reads += 1
        asked.push(options)

        // A stalled connection: the read settles only when the test says so.
        return new Promise((_resolve, reject) => {
          settleRead = () => reject(new Error('stalled'))
        })
      },
    },
  },
})
// The transcript helpers are not reached while the read hangs.
mock.module('../../../lib/analytics.ts', { namedExports: { trackError: () => {} } })
mock.module('./listedRuntimeState.ts', { namedExports: { listsRuntimeState: () => listed } })
mock.module('./model.ts', { namedExports: { CONVERSATION_TAIL_LIMIT: 50 } })
mock.module('./persistence.ts', {
  namedExports: { fromPersistedMessages: () => [], transcriptSignature: () => '' },
})
mock.module('./toUiMessages.ts', { namedExports: { toUiMessages: () => [] } })
const { useConversationCatchUp } = await import('./useConversationCatchUp.ts')

const settle = () => new Promise((resolve) => setImmediate(resolve))

function render(sessionId = 's1') {
  cleanup?.()
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Test harness re-runs the hook's effect.
  useConversationCatchUp({
    activeTab: {
      sessionId,
      claudeCodeRuntimeAttached: true,
      messages: [],
      streaming: false,
    },
    tabsRef: { current: [] },
    teamId: 't1',
    visible: true,
  } as never)
}

test('a re-run waits for the catch-up read already in flight', async () => {
  render()
  assert.equal(reads, 1)
  // A new message or a stream ending re-runs the effect while the read hangs.
  render()
  render()
  assert.equal(reads, 1)
  settleRead()
  await settle()
  render()
  assert.equal(reads, 2)
  cleanup?.()
})

test('the probe asks for the runtime state only of a session the list does not publish', async () => {
  for (const isListed of [true, false]) {
    listed = isListed
    asked.length = 0
    // Its own session: the first test leaves a read of s1 in flight.
    render(isListed ? 's2' : 's3')
    settleRead()
    await settle()
    assert.deepEqual(
      asked[0],
      isListed
        ? { tail: 1, messages: 'omit', runtimeState: 'omit' }
        : { tail: 1, messages: 'omit' },
    )
  }
  cleanup?.()
})
