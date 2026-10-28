import assert from 'node:assert/strict'
import { afterEach, mock, test } from 'node:test'

import type { AgentConversation } from '../../../api/agent-types.ts'

type Effect = () => (() => void) | undefined
const slots: unknown[] = []
let cursor = 0
let effectCursor = 0
const effects: {
  deps?: unknown[]
  cleanup?: () => void
  next?: Effect
}[] = []
let pending: AgentConversation[] = []
let loads = 0
let runtimeStates = new Map<string, { state: string }>()
const runtimeListeners = new Set<() => void>()
const windowListeners = new Map<string, Set<() => void>>()
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
    api: {
      agentListConversations: async () => {
        loads += 1

        return { conversations: pending, nextCursor: null }
      },
    },
  },
})
mock.module('../../../lib/agentRuntimeStates.ts', {
  namedExports: {
    getRuntimeStates: () => runtimeStates,
    subscribeRuntimeStates: (listener: () => void) => {
      runtimeListeners.add(listener)

      return () => runtimeListeners.delete(listener)
    },
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
    useEffect: (next: Effect, deps: unknown[]) => {
      effects[effectCursor] ??= {}
      const slot = effects[effectCursor++]!

      if (slot.deps && deps.every((value, index) => Object.is(value, slot.deps![index]))) return
      slot.deps = deps
      slot.next = next
    },
  },
})
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    setTimeout: () => 0,
    clearTimeout: () => {},
    addEventListener: (type: string, listener: () => void) => {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set())
      windowListeners.get(type)!.add(listener)
    },
    removeEventListener: (type: string, listener: () => void) =>
      windowListeners.get(type)?.delete(listener),
  },
})

const { useSessionInputRequests } = await import('./useSessionInputRequests.ts')
const { refreshInputRequests } = await import('../../../lib/inputRequestRefresh.ts')
const settle = () => new Promise((resolve) => setImmediate(resolve))

function render(sessionId: string) {
  cursor = 0
  effectCursor = 0
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Test harness drives the hook's lifecycle.
  const result = useSessionInputRequests(sessionId, 'team')

  for (const slot of effects) {
    if (!slot.next) continue
    const next = slot.next

    slot.next = undefined
    slot.cleanup?.()
    slot.cleanup = next()
  }

  return result
}

function unmount() {
  for (const slot of effects) slot.cleanup?.()
  effects.length = 0
  slots.length = 0
  loads = 0
  runtimeStates = new Map()
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

test('a refresh signal and window focus reload at once, without waiting for the poll', async () => {
  pending = []
  render('first')
  await settle()
  assert.deepEqual(render('first').requests, [])
  pending = [question]
  refreshInputRequests()
  await settle()
  assert.equal(render('first').requests[0]?.pendingDecision?.toolCallId, 'question-1')
  pending = []
  for (const listener of windowListeners.get('focus') ?? []) listener()
  await settle()
  assert.deepEqual(render('first').requests, [])
})

test('a sub-agent changing runtime state reloads; an unrelated session does not', async () => {
  pending = [question]
  render('first')
  await settle()
  render('first')
  const before = loads

  runtimeStates = new Map([['second', { state: 'active' }]])
  for (const listener of runtimeListeners) listener()
  await settle()
  assert.equal(loads, before)
  runtimeStates = new Map([
    ['second', { state: 'active' }],
    ['child', { state: 'idle' }],
  ])
  for (const listener of runtimeListeners) listener()
  await settle()
  assert.equal(loads, before + 1)
})

test('unmounting stops listening for refreshes', async () => {
  pending = []
  render('first')
  await settle()
  unmount()
  refreshInputRequests()
  await settle()
  assert.equal(loads, 0)
  assert.equal(windowListeners.get('focus')?.size ?? 0, 0)
})
