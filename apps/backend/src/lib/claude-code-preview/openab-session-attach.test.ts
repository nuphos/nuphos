import { beforeEach, expect, test } from 'bun:test'

import { attachOpenAbSession } from './openab-session-attach'

import type { OpenAbSessionRuntime } from './openab-acp-session'
import type { RuntimeDefaults } from './openab-acp-session'
import type { TeamPreviewClient } from './team-openab-runtime'
import type { ConversationPreviewAttachment } from '@/lib/agent/db/shared'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'

let attachment: ConversationPreviewAttachment | null = null
let defaults: RuntimeDefaults = {}
let readsFail = false
const calls: { method: string; runtime?: OpenAbSessionRuntime }[] = []

useAgentDb({
  getConversationPreviewAttachment: () =>
    readsFail ? Promise.reject(new Error('Database unavailable')) : Promise.resolve(attachment),
  setConversationPreviewAttachment: (_id, _team, value) => {
    attachment = value

    return Promise.resolve()
  },
})
useDb({
  db: () => ({
    collection: (name: string) => ({
      findOne: () =>
        Promise.resolve(name === 'agent_conversations' ? { initialSessionConfig: defaults } : null),
    }),
  }),
})

const noop = () => {}

function client(overrides: Partial<TeamPreviewClient> = {}): TeamPreviewClient {
  return {
    initialize: () => Promise.resolve({}),
    getSessionExecutionState: () => Promise.resolve({ state: 'dormant' }),
    sessionRequests: async () => ({}),
    getRuntimeExecutionState: async () => ({ sessions: [] }),
    runtimeLogin: async () => ({ exitCode: 0 }),
    cancelRuntimeLogin: async () => ({ cancelled: false }),
    runtimeLoginInput: async () => ({ delivered: true }),
    onRuntimeLoginFrame: () => noop,
    createSession: (_cwd, _mcp, _prompt, runtime) => {
      calls.push({ method: 'create', runtime })

      return Promise.resolve('new-session')
    },
    loadSession: (_id, _cwd, _mcp, _prompt, runtime) => {
      calls.push({ method: 'resume', runtime })

      return Promise.resolve({ alive: true })
    },
    prompt: () => Promise.resolve({}),
    cancel: noop,
    close: noop,
    onClosed: () => noop,
    onRetired: () => noop,
    onSessionUpdate: () => noop,
    onSessionPermission: () => noop,
    ...overrides,
  }
}
const endpoint = { url: 'wss://runtime.invalid/acp', authKey: 'test', runtimeId: 'runtime' }
const attach = (connection = client()) =>
  attachOpenAbSession(connection, 'team', 'conversation', endpoint, [], undefined, {
    provider: 'codex',
    env: { NUPHOS_TOKEN: 'scoped' },
  })

beforeEach(() => {
  attachment = null
  defaults = {}
  readsFail = false
  calls.length = 0
})

test('a new session snapshots the conversation’s picks into native session metadata', async () => {
  defaults = { model: 'b', fast: 'off', effort: 'high' }
  expect(await attach()).toEqual({ openabSessionId: 'new-session', fresh: true, defaults })
  expect(calls).toEqual([
    { method: 'create', runtime: { provider: 'codex', env: { NUPHOS_TOKEN: 'scoped' }, defaults } },
  ])
  expect(attachment).toEqual({
    openabSessionId: 'new-session',
    runtimeUrl: endpoint.url,
    runtimeDefaults: defaults,
  })
})

test('a later pick never overwrites a started session on resume or session replacement', async () => {
  defaults = { model: 'b' }
  attachment = {
    openabSessionId: 'existing',
    runtimeUrl: endpoint.url,
    runtimeDefaults: { model: 'a' },
  }
  await attach()
  expect(calls[0]?.runtime?.defaults).toEqual({ model: 'a' })
  await expect(
    attach(client({ loadSession: () => Promise.reject(new Error('Runtime session is busy')) })),
  ).rejects.toThrow('Runtime session is busy')
  expect(calls).toHaveLength(1)
  expect(attachment?.openabSessionId).toBe('existing')
  expect(attachment?.runtimeDefaults).toEqual({ model: 'a' })
})

test('legacy sessions never pick up a later pick', async () => {
  defaults = { model: 'b' }
  attachment = { openabSessionId: 'existing', runtimeUrl: endpoint.url }
  await attach()
  expect(calls[0]?.runtime?.defaults).toEqual({})
})

test('failed placement reads cannot start a fresh session', async () => {
  readsFail = true
  await expect(attach()).rejects.toThrow('Database unavailable')
  expect(calls).toEqual([])
})
