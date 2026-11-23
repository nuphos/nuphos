import assert from 'node:assert/strict'
import { beforeEach, mock, test } from 'node:test'

import type { AgentConversationDetail } from '../../../api.ts'
import type { OpenConversationCtx } from './openConversation.ts'
import type { Tab } from './model.ts'

// The query cache, as the two calls the open path makes on it.
const store = new Map<string, unknown>()
const keyOf = (key: readonly unknown[]) => JSON.stringify(key)
const queryClient = {
  getQueryData: (key: readonly unknown[]) => store.get(keyOf(key)),
  setQueryData: (key: readonly unknown[], value: unknown) => store.set(keyOf(key), value),
}
const reads: string[] = []
let served: AgentConversationDetail
const identity = <T>(value: T) => value

mock.module('../../../api.ts', {
  namedExports: {
    api: {
      agentGetConversation: (sessionId: string) => {
        reads.push(sessionId)

        return Promise.resolve(served)
      },
    },
  },
})
mock.module('../../../lib/query/client.ts', { namedExports: { queryClient } })
mock.module('../../../architecture/activeDiagram.ts', {
  namedExports: { getActiveDiagramId: () => null },
})
mock.module('../../../i18n/index.ts', { namedExports: { t: identity } })
mock.module('../../../lib/agentRuntimeStates.ts', {
  namedExports: { publishRuntimeStates: () => {} },
})
mock.module('../../../lib/analytics.ts', { namedExports: { trackError: () => {} } })
mock.module('../../../lib/openedConversation.ts', {
  namedExports: { rememberOpenedConversation: () => {} },
})
mock.module('../../ui/toast.ts', { namedExports: { toast: { apiError: () => {} } } })
mock.module('./clientTools.ts', { namedExports: { finalizeIncompleteTools: identity } })
mock.module('./conversationUnavailable.ts', { namedExports: { openingAfterFailure: () => null } })
mock.module('./conversationCredentialAccess.ts', {
  namedExports: { storedConversationCredentialAccess: (stored: unknown) => stored ?? {} },
})
mock.module('./credentialAccess.ts', {
  namedExports: { credentialOptionsLoaded: () => true, credentialSelectionSignature: () => '' },
})
mock.module('./loadedCredentialOptions.ts', {
  namedExports: { loadedCredentialOptions: (_teamId: string, options: unknown) => options },
})
mock.module('./persistence.ts', {
  namedExports: { fromPersistedMessages: identity, transcriptSignature: () => '' },
})
mock.module('./stall.ts', { namedExports: { INTERRUPTED_TOOL_MESSAGE: '', uid: () => 'tab' } })
mock.module('./textUtils.ts', { namedExports: { getAgentLocale: () => 'en' } })
mock.module('./toUiMessages.ts', { namedExports: { toUiMessages: identity } })

const { queryKeys } = await import('../../../lib/query/keys.ts')
const { cachedTask, keepTaskSelection } = await import('./taskTranscript.ts')
const { runOpenConversation } = await import('./openConversation.ts')

const TEAM = 'team'

function detail(text: string, revision: string, extra?: object): AgentConversationDetail {
  return {
    sessionId: 's1',
    title: 'Task',
    messages: [{ role: 'user', content: text }],
    messageCount: 1,
    transcriptUpdatedAt: revision,
    ...extra,
  } as unknown as AgentConversationDetail
}

/** What the sidebar's polled session list says about the Task. */
function listed(revision: string) {
  queryClient.setQueryData(queryKeys.agentSessions(TEAM), [
    { sessionId: 's1', messageCount: 1, transcriptUpdatedAt: revision },
  ])
}

function panel() {
  let tabs: Tab[] = []
  const spinners: unknown[] = []
  const ctx = {
    clearPendingOpen: () => {},
    credentialAccessRef: { current: new Map() },
    credentialOptions: {},
    history: [],
    kubeContextRef: { current: null },
    lastCredentialSyncedRef: { current: new Map() },
    lastSyncedRef: { current: new Map() },
    openGenerationRef: { current: 0 },
    pendingOpenRef: { current: null },
    setActiveId: () => {},
    setOpeningConversation: (value: unknown) => {
      if (value && typeof value !== 'function') spinners.push(value)
    },
    setTabAuditReadOnly: () => {},
    setTabs: (update: Tab[] | ((prev: Tab[]) => Tab[])) => {
      tabs = typeof update === 'function' ? update(tabs) : update
    },
    tabsRef: {
      get current() {
        return tabs
      },
    },
    teamId: TEAM,
    urlRef: { current: '' },
    uploadingTabsRef: { current: new Set() },
  } as unknown as OpenConversationCtx

  return { ctx, spinners, text: () => JSON.stringify(tabs[0]?.messages), tab: () => tabs[0] }
}

beforeEach(() => {
  store.clear()
  reads.length = 0
})

test('a Task read before, still current in the list, opens from that copy without a read or spinner', async () => {
  queryClient.setQueryData(queryKeys.task(TEAM, 's1'), detail('cached', 'r1'))
  listed('r1')
  const { ctx, spinners, text } = panel()

  await runOpenConversation(ctx, 's1')

  assert.deepEqual(reads, [])
  assert.deepEqual(spinners, [])
  assert.match(text(), /cached/)
})

test('a Task that changed since its copy was read opens from a fresh read, which replaces the copy', async () => {
  queryClient.setQueryData(queryKeys.task(TEAM, 's1'), detail('cached', 'r1'))
  listed('r2')
  served = detail('fresh', 'r2')
  const { ctx, spinners, text } = panel()

  await runOpenConversation(ctx, 's1')

  assert.deepEqual(reads, ['s1'])
  assert.equal(spinners.length, 1)
  assert.match(text(), /fresh/)
  assert.equal(queryClient.getQueryData(queryKeys.task(TEAM, 's1')), served)
})

test('a Task never read opens from a read and keeps it for the next open', async () => {
  listed('r1')
  served = detail('fresh', 'r1')
  const { ctx } = panel()

  await runOpenConversation(ctx, 's1')

  assert.deepEqual(reads, ['s1'])
  assert.equal(cachedTask(queryClient as never, TEAM, 's1'), served)
})

test('a copy with a reply in progress, or one the list does not show, is not used', () => {
  queryClient.setQueryData(
    queryKeys.task(TEAM, 's1'),
    detail('cached', 'r1', { activeRun: { streamId: 'x' } }),
  )
  listed('r1')
  assert.equal(cachedTask(queryClient as never, TEAM, 's1'), undefined)

  queryClient.setQueryData(queryKeys.task(TEAM, 's1'), detail('cached', 'r1'))
  queryClient.setQueryData(queryKeys.agentSessions(TEAM), [])
  assert.equal(cachedTask(queryClient as never, TEAM, 's1'), undefined)
  assert.equal(cachedTask(queryClient as never, undefined, 's1'), undefined)
})

// #4022: read ahead, then "Use in task" in the Inbox; the Task opened from the copy unselected.
test('a Task read before its selection was saved elsewhere opens with that selection', async () => {
  queryClient.setQueryData(queryKeys.task(TEAM, 's1'), detail('cached', 'r1'))
  listed('r1')
  const gmail = { personalCredentialIds: ['gmail'] } as never

  keepTaskSelection(queryClient as never, TEAM, 's1', gmail)
  const { ctx, tab } = panel()

  await runOpenConversation(ctx, 's1')

  assert.deepEqual(reads, [])
  assert.deepEqual(tab()?.credentialAccess, gmail)
})
