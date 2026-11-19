import assert from 'node:assert/strict'
import { before, beforeEach, mock, test } from 'node:test'

import type { Tab } from './model.ts'

const identity = (value: unknown) => value
let uploads: { sessionId: string; messages: unknown[]; import: boolean }[] = []
let links: string[][] = []
let tabs: Tab[] = []
let errors: string[] = []
let persist: () => Promise<void> = () => Promise.resolve()
let link: () => Promise<void> = () => Promise.resolve()
let fork: (source: string, edit?: { messageId: string; text: string }) => Promise<void>
let sourceMessages = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }]
let sequence = 0

before(async () => {
  mock.module('react', {
    namedExports: {
      useCallback: identity,
      useEffect: () => null,
      useRef: (current: unknown) => ({ current }),
    },
  })
  mock.module('../../../api.ts', {
    namedExports: {
      api: {
        agentGetConversation: async () => ({
          title: 'Source chat',
          messages: sourceMessages,
          runtimeId: 'source-runtime',
        }),
        agentSyncConversationTranscript: async (args: (typeof uploads)[number]) => {
          uploads.push(args)
          await persist()
        },
        agentRecordFork: async (...args: string[]) => {
          links.push(args)
          await link()
        },
      },
    },
  })
  mock.module('../../../lib/agentAvatarChoices.ts', {
    namedExports: { agentAvatarPick: () => {} },
  })
  mock.module('../../../i18n/index.ts', { namedExports: { t: identity } })
  mock.module('../../ui/toast.ts', {
    namedExports: {
      toast: {
        apiError: (title: string) => errors.push(title),
        error: (title: string) => errors.push(title),
      },
    },
  })
  mock.module('./clientTools.ts', { namedExports: { finalizeIncompleteTools: identity } })
  mock.module('./constants.ts', { namedExports: { EMPTY_CREDENTIAL_ACCESS: {} } })
  mock.module('./credentialAccess.ts', {
    namedExports: {
      normalizeCredentialAccess: identity,
      credentialOptionsCount: () => 0,
      defaultCredentialAccess: () => ({}),
      credentialSelectionSignature: JSON.stringify,
    },
  })
  mock.module('./dispatchTurn.ts', { namedExports: { forkImport: () => null } })
  mock.module('./forkStored.ts', { namedExports: { afterForkStored: () => Promise.resolve() } })
  mock.module('./loadEarlierMessages.ts', { namedExports: { runLoadEarlierMessages: () => null } })
  mock.module('./openConversation.ts', { namedExports: { runOpenConversation: () => null } })
  mock.module('./persistence.ts', { namedExports: { fromPersistedMessages: identity } })
  mock.module('./stall.ts', {
    namedExports: { INTERRUPTED_TOOL_MESSAGE: '', uid: () => `id-${++sequence}` },
  })
  mock.module('./toUiMessages.ts', { namedExports: { toPersistedMessages: identity } })
  mock.module('./timelineEvents.ts', { namedExports: { announceTimelineChange: () => null } })
})

beforeEach(async () => {
  uploads = []
  links = []
  errors = []
  sequence = 0
  tabs = [{ id: 'source-tab', sessionId: 'source' } as Tab]
  persist = () => Promise.resolve()
  link = () => Promise.resolve()
  sourceMessages = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }]
  const { useConversationOpen } = await import('./useConversationOpen.ts')

  fork = useConversationOpen({
    teamId: 'team',
    credentialOptions: null,
    tabs,
    tabsRef: {
      get current() {
        return tabs
      },
    },
    setTabs: (next: Tab[] | ((prev: Tab[]) => Tab[])) => {
      tabs = typeof next === 'function' ? next(tabs) : next
    },
    setActiveId: () => null,
    setOpeningConversation: () => null,
    credentialAccessRef: { current: new Map() },
    lastCredentialSyncedRef: { current: new Map() },
  } as unknown as Parameters<typeof useConversationOpen>[0]).forkConversation
})

test('fork stores history before it is opened, without sending a message', async () => {
  let resolve!: () => void

  persist = () =>
    new Promise<void>((done) => {
      resolve = done
    })
  const pending = fork('source')

  await Promise.resolve()
  assert.equal(uploads.length, 1)
  assert.equal(tabs[0].sessionId, 'source')
  assert.equal(links.length, 0)
  resolve()
  await pending
  assert.equal(tabs[0].sessionId, uploads[0].sessionId)
  assert.equal(tabs[0].runtimeId, 'source-runtime')
  assert.equal(tabs[0].unsaved, false)
  assert.equal(tabs[0].streaming, false)
  assert.equal(uploads[0].import, true)
  assert.deepEqual(uploads[0].messages, sourceMessages)
  assert.deepEqual(links, [['source', uploads[0].sessionId, 'team']])
})

test('failed history storage keeps the source open and records no success notice', async () => {
  persist = async () => {
    throw new Error('offline')
  }
  await fork('source')
  assert.equal(tabs[0].sessionId, 'source')
  assert.equal(links.length, 0)
  assert.deepEqual(errors, ['Could not fork'])
})

test('a missing notice endpoint does not strand a successfully stored fork', async () => {
  link = async () => {
    throw new Error('older server')
  }
  await fork('source')
  assert.equal(tabs[0].sessionId, uploads[0].sessionId)
  assert.deepEqual(errors, ['Could not link the fork to its source'])
})

test('an empty fork is stored too', async () => {
  sourceMessages = []
  await fork('source')
  assert.deepEqual(uploads[0].messages, [])
  assert.equal(tabs[0].unsaved, false)
})

test('a slower import cannot replace a newer fork', async () => {
  let resolve!: () => void
  let count = 0

  persist = () =>
    ++count === 1
      ? new Promise<void>((done) => {
          resolve = done
        })
      : Promise.resolve()
  const slow = fork('source')

  await Promise.resolve()
  await fork('source')
  const newer = tabs[0].sessionId

  resolve()
  await slow
  assert.equal(tabs[0].sessionId, newer)
  assert.equal(newer, uploads[1].sessionId)
})
