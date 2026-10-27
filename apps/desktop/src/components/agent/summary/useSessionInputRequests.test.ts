import assert from 'node:assert/strict'
import { afterEach, mock, test } from 'node:test'

import type { AgentConversation } from '../../../api/agent-types.ts'

const slots: unknown[] = []
let cursor = 0
let dependencies: unknown[] | undefined
let cleanup: (() => void) | undefined
let effect: (() => (() => void) | undefined) | undefined
let pending: AgentConversation[] = []
const known = [
  { sessionId: 'first', teamId: 'team' },
  { sessionId: 'second', teamId: 'team' },
] as AgentConversation[]
const question = {
  sessionId: 'child',
  teamId: 'team',
  parentSessionId: 'first',
  pendingDecision: {
    category: 'preference',
    question: 'Which layout?',
    toolCallId: 'question-1',
    askedAt: '2026-10-27T13:00:00Z',
  },
} as AgentConversation

mock.module('../../../api.ts', {
  namedExports: {
    api: { agentListConversations: async () => ({ conversations: pending, nextCursor: null }) },
  },
})
mock.module('../../../lib/openedConversation.ts', {
  namedExports: { useOpenedConversation: () => null },
})
mock.module('../../../lib/swrCache.ts', { namedExports: { useSwrCache: () => known } })
mock.module('../../sidebar/state.ts', { namedExports: { agentSessionsCacheKey: () => 'team' } })
mock.module('react', {
  namedExports: {
    useState: (initial: unknown) => {
      const index = cursor++

      if (!(index in slots)) slots[index] = initial

      return [
        slots[index],
        (value: unknown) => {
          slots[index] = value
        },
      ]
    },
    useMemo: (calculate: () => unknown) => calculate(),
    useEffect: (next: typeof effect, deps: unknown[]) => {
      if (dependencies && deps.every((value, index) => Object.is(value, dependencies![index])))
        return
      cleanup?.()
      dependencies = deps
      effect = next
    },
  },
})
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { setTimeout: () => 0, clearTimeout: () => {} },
})

const { useSessionInputRequests } = await import('./useSessionInputRequests.ts')
const settle = () => new Promise((resolve) => setImmediate(resolve))

function render(sessionId: string) {
  cursor = 0
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Test harness drives the hook's lifecycle.
  const result = useSessionInputRequests(sessionId, 'team')

  if (effect) {
    const next = effect

    effect = undefined
    cleanup = next()
  }

  return result
}

function unmount() {
  cleanup?.()
  cleanup = undefined
  effect = undefined
  dependencies = undefined
  slots.length = 0
}
afterEach(unmount)

test('switching to another session and back reloads the same unanswered question', async () => {
  pending = [question]
  render('first')
  await settle()
  assert.equal(render('first').requests[0]?.pendingDecision?.toolCallId, 'question-1')
  render('second')
  await settle()
  assert.deepEqual(render('second').requests, [])
  render('first')
  await settle()
  assert.equal(render('first').requests[0]?.pendingDecision?.toolCallId, 'question-1')
})

test('unmounting the panel preserves the question; a resolved question stays absent on return', async () => {
  pending = [question]
  render('first')
  await settle()
  unmount()
  render('first')
  await settle()
  assert.equal(render('first').requests.length, 1)
  pending = []
  render('second')
  await settle()
  render('first')
  await settle()
  assert.deepEqual(render('first').requests, [])
})
