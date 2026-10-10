import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { before, mock, test } from 'node:test'

import { AGENT_PROVIDERS } from '../../../types/runtime.ts'

import type { Message, Tab } from './model'
import type { TransferUploadPart } from './parts'
import type { StartChatCtx } from './startChat.ts'
import type { WindowAgentApi } from '../../../api/window-agent'
import type { AgentProvider } from '../../../types/runtime.ts'

let runStartChatWith: typeof import('./startChat.ts').runStartChatWith
const requests: Parameters<WindowAgentApi['agentStart']>[0][] = []

before(async () => {
  // Keep renderer/platform services outside this dispatch test. The actual
  // start flow owns the draft, transcript sync, and deferred upload closure.
  mock.module('../../../architecture/activeDiagram.ts', {
    namedExports: { getActiveDiagramId: () => null },
  })
  mock.module('../../../lib/analytics.ts', {
    namedExports: { track: () => {}, trackError: () => {} },
  })
  mock.module('../../ui/toast.ts', {
    namedExports: { toast: { apiError: () => {}, error: () => {} } },
  })
  mock.module('./credentialAccess.ts', {
    namedExports: { credentialSelectionSignature: JSON.stringify },
  })
  mock.module('./stall.ts', { namedExports: { uid: randomUUID, newAgentStreamId: randomUUID } })
  mock.module('./textUtils.ts', { namedExports: { getAgentLocale: () => 'en-US' } })
  mock.module('./toUiMessages.ts', {
    namedExports: { toUiMessages: (messages: Message[]) => messages },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      api: {
        agentStart: (args: Parameters<WindowAgentApi['agentStart']>[0]) => {
          requests.push(args)

          return Promise.resolve()
        },
      },
    },
  })
  ;({ runStartChatWith } = await import('./startChat.ts'))
})

function context(runtime: AgentProvider) {
  let tabs: Tab[] = []
  const synced: Tab[] = []
  const ctx: StartChatCtx = {
    teamId: 'same-workspace',
    newConversationRuntime: {
      id: `instance-${runtime}`,
      provider: runtime,
      label: `${runtime} work`,
      status: 'active',
      kind: 'managed',
      createdAt: '',
    },
    newConversationSessionConfig: {},
    newConversationCredentialAccess: {} as StartChatCtx['newConversationCredentialAccess'],
    defaultPermissionMode: 'auto',
    credentialAccessRef: { current: new Map() },
    lastCredentialSyncedRef: { current: new Map() },
    uploadingTabsRef: { current: new Set() },
    kubeContextRef: { current: null },
    urlRef: { current: undefined },
    setActiveId: () => {},
    setBypassBySession: () => {},
    setTabs: (update) => {
      tabs = typeof update === 'function' ? update(tabs) : update
    },
    syncTranscriptNow: (tab) => {
      synced.push(tab)
    },
  }

  return { ctx, synced, tabs: () => tabs }
}

test('each new conversation sends its chosen runtime and stamps the first transcript', () => {
  requests.length = 0
  for (const runtime of AGENT_PROVIDERS) {
    const state = context(runtime)

    runStartChatWith(state.ctx, 'hello')
    assert.equal(state.tabs()[0].agentRuntime, runtime)
    assert.equal(state.synced[0].agentRuntime, runtime)
    assert.equal(state.synced[0].runtimeId, `instance-${runtime}`)
    assert.equal(requests.at(-1)?.runtimeId, `instance-${runtime}`)
    assert.equal(requests.at(-1)?.agentRuntime, runtime)
    assert.equal(requests.at(-1)?.sessionId, state.synced[0].sessionId)
    assert.equal(requests.at(-1)?.initialSessionConfig, undefined)
  }
  assert.notEqual(requests[0].sessionId, requests[1].sessionId)
  assert.equal(requests[0].teamId, requests[1].teamId)
})

test('an upload retains the runtime captured at send time even when the next draft changes', async () => {
  requests.length = 0
  const state = context('codex')
  const upload = Promise.withResolvers<TransferUploadPart>()

  runStartChatWith(state.ctx, 'inspect attachment', undefined, {
    messageId: 'upload',
    run: () => upload.promise,
  })
  assert.equal(requests.length, 0)
  assert.equal(state.synced[0].agentRuntime, 'codex')
  state.ctx.newConversationRuntime = {
    ...state.ctx.newConversationRuntime!,
    id: 'other-codex',
    label: 'Codex personal',
  }
  upload.resolve({
    type: 'transfer-upload',
    status: 'ready',
    files: [],
  } as unknown as TransferUploadPart)
  await upload.promise
  await Promise.resolve()
  assert.equal(requests[0].agentRuntime, 'codex')
  assert.equal(requests[0].runtimeId, 'instance-codex')
  assert.ok(state.synced.every((tab) => tab.agentRuntime === 'codex'))
  assert.equal(state.tabs()[0].agentRuntime, 'codex')
})

test('two conversations using Codex keep different runtime instance IDs', () => {
  requests.length = 0
  const work = context('codex')
  const personal = context('codex')

  personal.ctx.newConversationRuntime = {
    ...personal.ctx.newConversationRuntime!,
    id: 'codex-personal',
    label: 'Personal',
  }
  runStartChatWith(work.ctx, 'work')
  runStartChatWith(personal.ctx, 'personal')
  assert.equal(requests[0].agentRuntime, requests[1].agentRuntime)
  assert.notEqual(requests[0].runtimeId, requests[1].runtimeId)
})

test('an unavailable runtime does not create a conversation or send a prompt', () => {
  requests.length = 0
  const state = context('codex')

  state.ctx.newConversationRuntime = null
  runStartChatWith(state.ctx, 'keep this draft')
  assert.equal(requests.length, 0)
  assert.equal(state.synced.length, 0)
  assert.equal(state.tabs().length, 0)
})

test('first prompt has sender attribution before the agent acknowledges it', () => {
  const state = context('codex')

  state.ctx.currentUser = {
    id: 'viewer',
    name: 'Yuan',
    username: 'yuan',
    email: 'yuan@example.com',
    avatarURL: 'https://lh3.googleusercontent.com/avatar',
  }
  runStartChatWith(state.ctx, 'hello')
  const message = state.tabs()[0]?.messages[0]

  assert.ok(message?.createdAt)

  assert.equal(message.metadata?.sender.id, 'viewer')
  assert.equal(message.metadata?.sender.displayName, 'Yuan')
  assert.equal(message.metadata?.sender.avatarURL, state.ctx.currentUser.avatarURL)
  assert.equal(message.metadata?.sentAt, new Date(message.createdAt).toISOString())
})

test('the first message carries the model settings picked before the session existed', () => {
  const state = context('codex')

  state.ctx.newConversationSessionConfig = { model: 'gpt-6.1', effort: 'high' }
  runStartChatWith(state.ctx, 'hello')
  assert.deepEqual(requests.at(-1)?.initialSessionConfig, { model: 'gpt-6.1', effort: 'high' })
})
