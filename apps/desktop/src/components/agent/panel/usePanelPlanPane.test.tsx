import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'

const react = await import('react')
const apiModule = await import('../../../api')
let listCalls = 0
const cleanups: (() => void)[] = []

mock.module('react', () => ({
  ...react,
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => undefined | (() => void)) => {
    const cleanup = fn()

    if (cleanup) cleanups.push(cleanup)
  },
  useMemo: (fn: () => unknown) => fn(),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [typeof value === 'function' ? value() : value, () => undefined],
}))
mock.module('../../../api', () => ({
  ...apiModule,
  api: {
    agentListPlans: async () => {
      listCalls++

      return { plans: [] }
    },
  },
}))
const { usePanelPlanPane } = await import('./usePanelPlanPane')

test('a streaming conversation without a Plan does not list Plans', async () => {
  listCalls = 0
  usePanelPlanPane({
    activeId: 'tab',
    activeTab: { sessionId: 'session', streaming: true, messages: [] },
    teamId: 'team',
    panelRootRef: { current: null },
    credentialAccessRef: { current: new Map() },
    lastCredentialSyncedRef: { current: new Map() },
    visible: false,
    variant: 'page',
  } as never)
  await new Promise((resolve) => setImmediate(resolve))
  for (const cleanup of cleanups.splice(0)) cleanup()
  assert.equal(listCalls, 0)
})
