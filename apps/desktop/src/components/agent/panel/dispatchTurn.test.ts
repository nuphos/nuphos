import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { before, mock, test } from 'node:test'

import type { DispatchTurnCtx } from './dispatchTurn.ts'
import type { Message, Tab } from './model'
import type { WindowAgentApi } from '../../../api/window-agent'

type SyncArgs = Parameters<WindowAgentApi['agentSyncConversationTranscript']>[0]
type StartArgs = Parameters<WindowAgentApi['agentStart']>[0]

let runDispatchTurn: typeof import('./dispatchTurn.ts').runDispatchTurn
const calls: (['sync', SyncArgs] | ['start', StartArgs])[] = []
let failImport = false
// Holds the import open until a test lets it finish.
let importGate: Promise<void> | null = null

before(async () => {
  mock.module('../../../architecture/activeDiagram.ts', {
    namedExports: { getActiveDiagramId: () => null },
  })
  mock.module('../../../lib/analytics.ts', {
    namedExports: { track: () => {}, trackError: () => {} },
  })
  mock.module('../../ui/toast.ts', {
    namedExports: { toast: { apiError: () => {}, error: () => {} } },
  })
  mock.module('./attachments.ts', {
    namedExports: {
      makeAttachmentTurn: (text: string) => ({
        messageId: text,
        optimisticPart: () => null,
        buildUserMsg: (): Message => ({ id: text, role: 'user', parts: [{ type: 'text', text }] }),
        runUpload: () => Promise.resolve(null),
      }),
    },
  })
  mock.module('./clientTools.ts', {
    namedExports: {
      finalizeIncompleteTools: (messages: Message[]) => messages,
      supersedePendingApprovals: (messages: Message[]) => messages,
    },
  })
  mock.module('./queuedAutoSend.ts', {
    namedExports: {
      rememberDispatchedDraft: () => {},
      rememberSideSend: () => {},
      showQueued: (tab: unknown) => tab,
      withoutQueued: (tab: unknown) => tab,
    },
  })
  mock.module('./stall.ts', {
    namedExports: { INTERRUPTED_TOOL_MESSAGE: 'interrupted', newAgentStreamId: randomUUID },
  })
  mock.module('./textUtils.ts', { namedExports: { getAgentLocale: () => 'en-US' } })
  mock.module('./toUiMessages.ts', {
    namedExports: {
      toUiMessages: (messages: Message[]) => messages,
      toPersistedMessages: (messages: Message[]) => messages,
    },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      // i18n subscribes to locale changes in other windows on import.
      addEventListener: () => {},
      api: {
        agentSyncConversationTranscript: (args: SyncArgs) => {
          calls.push(['sync', args])

          return (importGate ?? Promise.resolve()).then(() => {
            if (failImport) throw new Error('import failed')
          })
        },
        agentStart: (args: StartArgs) => {
          calls.push(['start', args])

          return Promise.resolve()
        },
      },
    },
  })
  ;({ runDispatchTurn } = await import('./dispatchTurn.ts'))
})

const history: Message[] = [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'first' }] },
  { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'reply' }] },
]

function context(tab: Partial<Tab>) {
  let tabs = [{ id: 'tab', sessionId: 'fork', title: 'Fork', messages: history, ...tab } as Tab]
  const synced: Tab[] = []
  const ctx = {
    currentUser: null,
    credentialAccessRef: { current: new Map() },
    kubeContextRef: { current: null },
    sendableCredentialAccess: (access: unknown) => access,
    setTabs: (update: Tab[] | ((prev: Tab[]) => Tab[])) => {
      tabs = typeof update === 'function' ? update(tabs) : update
    },
    stoppedRunIdsRef: { current: new Set() },
    syncTranscriptNow: (next: Tab) => {
      synced.push(next)
    },
    tabsRef: {
      get current() {
        return tabs
      },
    },
    teamId: 'team',
    uploadingTabsRef: { current: new Set() },
    urlRef: { current: undefined },
  } as unknown as DispatchTurnCtx

  return { ctx, synced, tabs: () => tabs }
}

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

test("a fork's first send stores the copied turns as an import before starting", async () => {
  calls.length = 0
  failImport = false
  const state = context({ unsaved: true })

  await runDispatchTurn(state.ctx, 'tab', 'follow-up', [])
  await settle()

  // A regular sync would race the import and store the new message unattributed.
  assert.equal(state.synced.length, 0)

  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['sync', 'start'],
  )
  const [, sync] = calls[0] as ['sync', SyncArgs]

  assert.equal(sync.import, true)
  assert.equal(sync.sessionId, 'fork')
  assert.deepEqual(
    sync.messages.map((m) => m.id),
    ['u1', 'a1'],
  )
  assert.deepEqual(
    (calls[1][1] as StartArgs).messages.map((m) => m.id),
    ['u1', 'a1', 'follow-up'],
  )
})

test('a saved chat sends without an import', async () => {
  calls.length = 0
  failImport = false
  const state = context({ unsaved: false })

  await runDispatchTurn(state.ctx, 'tab', 'follow-up', [])
  await settle()

  assert.equal(state.synced.length, 1)

  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['start'],
  )
})

test('a failed import does not start the turn and surfaces the error', async () => {
  calls.length = 0
  failImport = true
  const state = context({ unsaved: true })

  await runDispatchTurn(state.ctx, 'tab', 'follow-up', [])
  await settle()

  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['sync'],
  )
  assert.equal(state.tabs()[0].streaming, false)
  assert.equal(state.tabs()[0].error, 'import failed')
  // Still a fork the server hasn't stored, so the next send imports again.
  assert.equal(state.tabs()[0].unsaved, true)

  failImport = false
  await runDispatchTurn(state.ctx, 'tab', 'again', [])
  await settle()

  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['sync', 'sync', 'start'],
  )
  assert.equal(state.tabs()[0].unsaved, false)
})

test("a send during a fork's import goes after its first turn, without a second import", async () => {
  calls.length = 0
  failImport = false
  let finishImport = () => {}

  importGate = new Promise((resolve) => {
    finishImport = () => resolve()
  })
  const state = context({ unsaved: true })

  await runDispatchTurn(state.ctx, 'tab', 'first prompt', [])
  await runDispatchTurn(state.ctx, 'tab', 'second prompt', [])
  await settle()
  // One import, and nothing starts before it lands.
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['sync'],
  )

  finishImport()
  importGate = null
  await settle()
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['sync', 'start', 'start'],
  )
  // The first prompt gets its own turn first; the second follows it, never as history.
  assert.deepEqual(
    calls.slice(1).map(([, args]) => (args as StartArgs).messages.map((m) => m.id)),
    [
      ['u1', 'a1', 'first prompt'],
      ['u1', 'a1', 'first prompt', 'second prompt'],
    ],
  )
})

test("a send during a fork's failed import is not sent with the first prompt as history", async () => {
  calls.length = 0
  failImport = true
  let finishImport = () => {}

  importGate = new Promise((resolve) => {
    finishImport = () => resolve()
  })
  const state = context({ unsaved: true })

  await runDispatchTurn(state.ctx, 'tab', 'first prompt', [])
  await runDispatchTurn(state.ctx, 'tab', 'second prompt', [])
  finishImport()
  importGate = null
  await settle()

  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['sync'],
  )
  assert.equal(state.tabs()[0].error, 'import failed')
  assert.equal(state.tabs()[0].unsaved, true)
})
