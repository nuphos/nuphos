import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

let cleanup: (() => void) | undefined
let reads = 0
let settleRead: () => void = () => {}

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
      agentGetConversation: () => {
        reads += 1

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
mock.module('./model.ts', { namedExports: { CONVERSATION_TAIL_LIMIT: 50 } })
mock.module('./persistence.ts', {
  namedExports: { fromPersistedMessages: () => [], transcriptSignature: () => '' },
})
mock.module('./toUiMessages.ts', { namedExports: { toUiMessages: () => [] } })
const { useConversationCatchUp } = await import('./useConversationCatchUp.ts')

const settle = () => new Promise((resolve) => setImmediate(resolve))

function render() {
  cleanup?.()
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Test harness re-runs the hook's effect.
  useConversationCatchUp({
    activeTab: {
      sessionId: 's1',
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
