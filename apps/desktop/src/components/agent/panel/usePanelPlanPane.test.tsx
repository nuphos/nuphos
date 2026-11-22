import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'

const react = await import('react')
const apiModule = await import('../../../api')
const reactQuery = await import('@tanstack/react-query')
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
// The sidebar's listing, as the query cache holds it.
let listed: { sessionId: string; title: string }[] = []

mock.module('@tanstack/react-query', () => ({
  ...reactQuery,
  useQuery: ({ select }: { select: (rows: typeof listed) => unknown }) => ({
    data: select(listed),
  }),
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

test('the titlebar is told the name the sidebar lists the Task by', () => {
  const reported: string[] = []
  const acc = {
    activeId: 'tab',
    activeTab: { sessionId: 'session', title: 'Check why the weekly sales repor…', messages: [] },
    teamId: 'team',
    panelRootRef: { current: null },
    credentialAccessRef: { current: new Map() },
    lastCredentialSyncedRef: { current: new Map() },
    visible: false,
    variant: 'page',
    onTitleChange: (title: string) => reported.push(title),
  } as never

  // Not listed yet: the panel's own name for it.
  listed = []
  usePanelPlanPane(acc)
  // Its agent renamed it, which only the listing hears of.
  listed = [{ sessionId: 'session', title: 'Audit weekly report totals' }]
  usePanelPlanPane(acc)
  for (const cleanup of cleanups.splice(0)) cleanup()
  assert.deepEqual(reported, ['Check why the weekly sales repor…', 'Audit weekly report totals'])
})
