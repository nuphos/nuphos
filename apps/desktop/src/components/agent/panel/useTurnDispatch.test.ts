import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

import type { Message, Tab } from './model.ts'
import type { RuntimeInstance } from '../../../types/runtime.ts'

// The hook is the shell around these. Each is replaced so a test can see what a
// send decided to do, with no server and no agent run behind it.
const toasts: { title: string; detail?: string }[] = []
const sent: { tabId: string; text: string; filePaths: string[] }[] = []
// The runtime each new conversation was opened with.
const started: (RuntimeInstance | null | undefined)[] = []
// A first send on a just-started local runtime waits on this, as the catalog does.
let listed: (() => Promise<RuntimeInstance | null>) | null = null
let useTurnDispatch: typeof import('./useTurnDispatch.ts').useTurnDispatch

before(async () => {
  // The hooks run outside a renderer here, so `useCallback` is the identity;
  // everything else stays real for the modules this graph pulls in.
  const react = await import('react')

  mock.module('react', { namedExports: { ...react, useCallback: (fn: unknown) => fn } })
  mock.module('./model.ts', { namedExports: { HOME_TAB_ID: 'home' } })
  mock.module('./textUtils.ts', { namedExports: { fileNameFromPath: (path: string) => path } })
  mock.module('../../../hooks/useCurrentUser.ts', { namedExports: { useCurrentUser: () => null } })
  mock.module('../../ui/toast.ts', {
    namedExports: {
      toast: {
        error: (title: string, detail?: string) => toasts.push({ title, detail }),
        apiError: () => {},
        info: () => {},
      },
    },
  })
  // Attachments are made on the way into the dispatcher, which is replaced below.
  mock.module('./attachments.ts', {
    namedExports: {
      makeAttachmentTurn: (text: string) => ({
        messageId: 'attachment',
        optimisticPart: () => null,
        buildUserMsg: (): Message => ({ id: 'attachment', role: 'user', parts: [] }),
        runUpload: () => Promise.resolve(null),
      }),
    },
  })
  // The real dispatcher renders the user's message synchronously, before its
  // first await, which is what "the send owns the draft" means here.
  mock.module('./dispatchTurn.ts', {
    namedExports: {
      runDispatchTurn: (_ctx: unknown, tabId: string, text: string, filePaths: string[]) => {
        sent.push({ tabId, text, filePaths })

        return Promise.resolve()
      },
    },
  })
  // The real steering puts the message in the queue strip synchronously too.
  mock.module('./useSteering.ts', {
    namedExports: {
      useSteering: () => (tabId: string, text: string, filePaths: string[]) => {
        sent.push({ tabId, text, filePaths })

        return Promise.resolve()
      },
    },
  })
  mock.module('./useQueueActions.ts', {
    namedExports: { useQueueActions: () => ({ steerQueued: () => {}, removeQueued: () => {} }) },
  })
  // The real one opens the conversation and reports whether it took the draft.
  mock.module('./startChat.ts', {
    namedExports: {
      runStartChatWith: (ctx: { newConversationRuntime?: RuntimeInstance | null }) => {
        started.push(ctx.newConversationRuntime)

        return ctx.newConversationRuntime?.status === 'active'
      },
    },
  })
  mock.module('./awaitListedAgent.ts', {
    namedExports: {
      awaitListedAgent: () => (listed ? listed() : Promise.resolve(null)),
    },
  })
  ;({ useTurnDispatch } = await import('./useTurnDispatch.ts'))
})

const active: Tab['runtimeState'] = {
  state: 'idle',
  schemaVersion: 2,
  actions: { send: true, cancel: false, steer: false, reply: true },
  label: 'Idle',
}
const busy: Tab['runtimeState'] = {
  state: 'active',
  schemaVersion: 2,
  actions: { send: true, cancel: true, steer: true, reply: false },
  label: 'Working',
}
// Takes nothing now and never will: a runtime too old to report its actions.
const mute: Tab['runtimeState'] = { state: 'idle', schemaVersion: 1, label: 'Out of date' }

const runtime = (starting: boolean): RuntimeInstance => ({
  id: 'local_1',
  provider: 'claude-code',
  label: 'This Mac',
  status: 'active',
  kind: 'local',
  createdAt: '',
  ...(starting ? { starting: true } : {}),
})

function panel(tab: Partial<Tab> = {}) {
  const tabs: Tab[] = [
    { id: 'open', sessionId: 'session-1', title: 'Open', messages: [], ...tab } as Tab,
  ]
  const acc = {
    activeId: 'open',
    credentialAccessRef: { current: new Map() },
    credentialOptions: undefined,
    defaultPermissionMode: 'auto',
    kubeContextRef: { current: null },
    lastCredentialSyncedRef: { current: new Map() },
    newConversationRuntime: null,
    newConversationSessionConfig: {},
    newConversationCredentialAccess: {},
    onOpenAgentSettings: undefined,
    replyTarget: null,
    sendableCredentialAccess: (access: unknown) => access,
    setActiveId: () => {},
    setBypassBySession: () => {},
    setTabs: () => {},
    stoppedRunIdsRef: { current: new Set() },
    syncTranscriptNow: () => {},
    tabsRef: { current: tabs },
    teamId: 'team-1',
    uploadingTabsRef: { current: new Set<string>() },
    urlRef: { current: undefined },
  } as unknown as Parameters<typeof useTurnDispatch>[0]

  return { acc, tabs }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('idle: a send the runtime takes is dispatched and accepted', () => {
  sent.length = 0
  const { acc } = panel({ runtimeState: active })

  assert.equal(useTurnDispatch(acc).sendInActive('ship it', []), true)
  assert.deepEqual(sent, [{ tabId: 'open', text: 'ship it', filePaths: [] }])
})

test('busy: a send into the running turn goes to the queue strip and is accepted', () => {
  sent.length = 0
  const { acc } = panel({ runtimeState: busy })

  assert.equal(useTurnDispatch(acc).sendInActive('use the other branch instead', []), true)
  assert.deepEqual(sent, [{ tabId: 'open', text: 'use the other branch instead', filePaths: [] }])
})

test('busy without a session: the steer is refused, not dropped, and the draft stays', () => {
  sent.length = 0
  toasts.length = 0
  const { acc } = panel({ runtimeState: busy, sessionId: '' })

  assert.equal(useTurnDispatch(acc).sendInActive('steer nowhere', []), false)
  assert.deepEqual(sent, [])
  assert.deepEqual(toasts, [
    { title: "The runtime isn't ready yet", detail: 'Your message was not sent. Send it again.' },
  ])
})

test('a read-only conversation trades nothing, so it is refused', () => {
  sent.length = 0
  const { acc } = panel({ runtimeState: active, readOnly: true })

  assert.equal(useTurnDispatch(acc).sendInActive('let me in', []), false)
  assert.deepEqual(sent, [])
})

test('a runtime that takes nothing and never will refuses, and says why', () => {
  sent.length = 0
  toasts.length = 0
  const { acc } = panel({ runtimeState: mute })

  assert.equal(useTurnDispatch(acc).sendInActive('are you there', []), false)
  assert.deepEqual(sent, [])
  // The label an out-of-date runtime reports for itself (runtimeExecution.ts).
  assert.deepEqual(toasts, [
    { title: 'Runtime status unavailable — runtime update required', detail: undefined },
  ])
})

test('a file send waits for the upload already in flight on that tab', () => {
  sent.length = 0
  toasts.length = 0
  const { acc } = panel({ runtimeState: active })

  acc.uploadingTabsRef.current.add('open')
  assert.equal(useTurnDispatch(acc).sendInActive('with a log', ['/Users/me/a.log']), false)
  assert.deepEqual(sent, [])
  assert.deepEqual(toasts, [{ title: 'Attachment upload is still in progress', detail: undefined }])
})

test('the first message opens a conversation, or is refused with no runtime', () => {
  sent.length = 0
  const { acc } = panel()

  acc.activeId = 'home'
  acc.newConversationRuntime = runtime(false)
  assert.equal(useTurnDispatch(acc).sendInActive('first words', []), true)

  acc.newConversationRuntime = null
  assert.equal(useTurnDispatch(acc).sendInActive('keep this', []), false)
})

test('a first send on a starting local runtime is held and accepted', async () => {
  sent.length = 0
  started.length = 0
  const { acc } = panel()
  const hold = Promise.withResolvers<RuntimeInstance | null>()

  acc.activeId = 'home'
  acc.newConversationRuntime = runtime(true)
  listed = () => hold.promise

  // Held: the send owns the draft now; the conversation opens when the runtime
  // is listed.
  assert.equal(useTurnDispatch(acc).sendInActive('are you up yet', []), true)
  hold.resolve(runtime(false))
  await settle()
  assert.deepEqual(started, [runtime(false)])
  listed = null
})

test('a starting runtime that never lists still reports the send held, then toasts', async () => {
  sent.length = 0
  toasts.length = 0
  const { acc } = panel()

  acc.activeId = 'home'
  acc.newConversationRuntime = runtime(true)
  listed = () => Promise.resolve(null)

  assert.equal(useTurnDispatch(acc).sendInActive('hello?', []), true)
  await settle()
  assert.deepEqual(toasts, [
    {
      title: 'The local runtime is still starting',
      detail: 'Try again in a moment, or check User settings › This computer › Local runtime.',
    },
  ])
  listed = null
})
