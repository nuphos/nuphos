import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { listSessionCredentials } from '@/lib/claude-code-preview/credential-listing'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentSessionsShared } from '@/lib/test/doubles/agent-sessions-shared'
import { real as realOptions, useCredentialOptions } from '@/lib/test/doubles/credential-options'
import { useConversationRuntimeMove } from '@/lib/test/doubles/conversation-runtime-move'
import { useDb } from '@/lib/test/doubles/db'
import { useConversationChatRoute } from '@/lib/test/doubles/conversation-chat-route'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'
import { useRuntimeModels } from '@/lib/test/doubles/runtime-models'
import { useSessionConfig } from '@/lib/test/doubles/session-config'

import { clearPendingUserMessages } from './pending-messages'
import { getSessionBypass, setSessionBypass } from './auto-mode/store'
import { threadReadGrants } from './db/access'
import {
  authorizeThreadDelivery,
  createAgentThread,
  listThreadRuntimes,
  sendAgentThreadMessage,
  updateThread,
  setAgentThreadArchived,
} from './thread-bridge'
import { installTurnRunner, resetTurnRunner } from './turn-runner'

import type { AgentConversation, AgentCredentialAccess } from './db'
import type { TurnRunner } from './turn-runner'

const access = {
  awsRoleIds: ['role-1'],
  updatedAt: new Date(),
  updatedBy: 'owner',
} as AgentCredentialAccess
const actor = { userId: 'owner', teamId: 'team', sessionId: 'source', locale: 'zh-TW' }
let source: AgentConversation
let target: AgentConversation
let member = true
const archives: unknown[][] = []
const claims: Parameters<TurnRunner['claimAgentRunOrEnqueue']>[0][] = []
const shells: Parameters<typeof import('./db').upsertConversationShell>[0][] = []

beforeEach(() => {
  source = {
    ...actor,
    title: 'Source',
    firstMessage: 'Original',
    messageCount: 1,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    credentialAccess: access,
    agentRuntime: 'codex',
    runtimeId: 'runtime-1',
  }
  target = { ...source, sessionId: 'target' }
  member = true
  archives.length = 0
  claims.length = 0
  shells.length = 0
  bypass.clear()
  events.length = 0
  moves.length = 0
  writes.length = 0
  removals.length = 0
  selections.clear()
  picks.length = 0
  getAccess = readSelection
  installTurnRunner({
    claimAgentRunOrEnqueue: async (args) => {
      claims.push(args)

      return { mode: 'queued' }
    },
  })
})
afterEach(async () => {
  resetTurnRunner()
  for (const id of ['target', ...shells.map((shell) => shell.sessionId)])
    await clearPendingUserMessages('owner', id)
})

useConversationChatRoute({
  resolveConversationChatRuntime: async () => ({ runtime: 'claude-code' }),
})
useIdentity({
  getTeamMembership: async () => (member ? { role: 'MEMBER' } : null),
  signNuphosToken: () => 'test-token',
})
const bypass = new Map<string, Record<string, unknown>>()
const events: { conversationId: string; event: string }[] = []
const moves: { sessionId: string; runtimeId: string; userId: string }[] = []
// Each conversation's selection as list_credentials reads it, and the fields grants write.
const selections = new Map<string, Partial<AgentCredentialAccess>>()
const writes: { sessionId: string; fields: Partial<Record<string, string[]>> }[] = []
const removals: {
  sessionId: string
  pull: Partial<Record<string, string[]>>
  narrow: Partial<Record<string, string[]>>
}[] = []
const options = await realOptions.getAgentCredentialOptions(undefined, 'owner')

useCredentialOptions({
  getAgentCredentialOptions: async () =>
    ({
      ...options,
      awsRoles: ['role-1', 'role-2'].map((roleId) => ({ roleId, accountId: roleId })),
      linearWorkspaces: [{ workspaceId: 'ws-1', label: 'Zeabur' }],
      // A connector whose unset selection means all of them.
      githubInstallations: ['gh-1', 'gh-2'].map((installationId) => ({
        installationId,
        accountLogin: installationId,
      })),
      devices: [
        { deviceId: 'mac-1', available: true },
        { deviceId: 'mac-2', available: true },
        { deviceId: 'offline-mac', available: false },
      ].map((device) => ({ ...device, label: device.deviceId, platform: 'darwin' })),
    }) as never,
})
const readSelection: typeof getAccess = async ({ sessionId }) =>
  (selections.get(sessionId) ?? {}) as never
let getAccess: (agent: { sessionId: string }) => Promise<never> = readSelection

useAgentSessionsShared({ getAgentCredentialAccess: async (agent) => getAccess(agent) })

useDb({
  db: () => ({
    collection: () => ({
      updateOne(
        filter: { conversationId: string; userId: string },
        update: { $setOnInsert?: Record<string, unknown>; $set?: Record<string, unknown> },
        options: { upsert?: boolean },
      ) {
        const key = `${filter.userId}:${filter.conversationId}`
        let doc = bypass.get(key)

        if (!doc && options.upsert) {
          doc = { ...filter, ...update.$setOnInsert }
          bypass.set(key, doc)
        }
        if (doc) Object.assign(doc, update.$set)

        return Promise.resolve()
      },
      findOne(filter: { conversationId: string; userId: string }) {
        return Promise.resolve(bypass.get(`${filter.userId}:${filter.conversationId}`) ?? null)
      },
    }),
  }),
})
useConversationRuntimeMove({
  moveConversationRuntime: async (conversation, runtimeId, userId) => {
    moves.push({ sessionId: conversation.sessionId, runtimeId, userId })

    return { runtimeId, runtimeLabel: 'Other', agentRuntime: 'codex' }
  },
})
useRuntimeCatalog({
  withRuntimeReadiness: async (_teamId, instances) => instances,
  listRuntimeQuotas: async (_teamId, instances) => instances.map(() => ({}) as never),
  // Without a user only the team's agents are listed; a local one would need the owner.
  listRuntimeInstances: async (_teamId, userId) => [
    {
      id: 'runtime-2',
      provider: 'codex',
      label: 'Other',
      status: 'active',
      kind: 'managed',
      createdAt: '',
    },
    ...(userId
      ? [
          {
            id: 'local-1',
            provider: 'codex' as const,
            label: 'Mac',
            status: 'active' as const,
            kind: 'local' as const,
            createdAt: '',
          },
          {
            id: 'box-1',
            provider: 'claude-code' as const,
            label: 'Claude Code in Box',
            status: 'active' as const,
            kind: 'local' as const,
            createdAt: '',
            local: { box: { provider: 'instabox' } } as never,
          },
        ]
      : []),
  ],
})
// What each agent offers to a delegating agent; one that cannot say is listed without models.
useRuntimeModels({
  runtimeModelCatalog: async (_teamId, runtimeId) => {
    if (runtimeId !== 'runtime-2') throw new Error('offline')

    return { models: [{ id: 'gpt-5.5', name: 'GPT-5.5', description: 'Strongest' }] }
  },
})
// The model picker: what each conversation was set to, and the runtime's catalog.
const picks: { sessionId: string; configId: string; value: string }[] = []
const offered = { model: ['claude-fable-5-1', 'default'], effort: ['high', 'low'] }

useSessionConfig({
  conversationSessionConfig: async (conversation, selection) => {
    const options = Object.entries(offered).map(([kind, values]) => ({
      id: kind,
      name: kind,
      kind: kind as 'model',
      currentValue: picks.findLast((pick) => pick.configId === kind)?.value ?? 'default',
      options: values.map((value) => ({ value, name: value })),
    }))

    if (!selection) return { status: 'ready', options }
    if (!offered[selection.configId as 'model'].includes(selection.value)) {
      const { AppError } = await import('@/lib/errors')

      throw new AppError(400, 'invalid_runtime_config', 'no longer available')
    }
    picks.push({ sessionId: conversation.sessionId, ...selection })

    return {
      status: 'ready',
      options: options.map((option) =>
        option.id === selection.configId ? { ...option, currentValue: selection.value } : option,
      ),
    }
  },
})
useAgentDb({
  setConversationArchived: async (...args) => {
    archives.push(args)

    return { sessionIds: [args[0]] }
  },
  getConversationBySessionId: async (id) =>
    id === 'source'
      ? source
      : id === 'target'
        ? target
        : shells.some((shell) => shell.sessionId === id)
          ? {
              ...source,
              sessionId: id,
              parentSessionId: shells.find((shell) => shell.sessionId === id)?.parentSessionId,
            }
          : null,
  upsertConversationShell: async (data) => {
    shells.push(data)

    return { isNew: true }
  },
  agentMessages: () => ({ findOne: async () => null }),
  recordAgentEvent: (event) => {
    events.push(event)
  },
  // The store's $addToSet, with the guard that a field in `existing` is still set.
  addConversationCredentialIds: async (sessionId, _userId, _teamId, fields, existing) => {
    const stored = selections.get(sessionId) ?? {}

    if (existing.some((key) => stored[key as keyof AgentCredentialAccess] === undefined))
      return null
    writes.push({ sessionId, fields })
    const next = { ...stored } as Record<string, unknown>

    for (const [key, ids] of Object.entries(fields))
      next[key] = [...new Set([...((next[key] as string[] | undefined) ?? []), ...(ids ?? [])])]
    selections.set(sessionId, next as Partial<AgentCredentialAccess>)

    return {} as AgentConversation
  },
  // The store's $pull and $set, guarded that pulled fields are lists and narrowed
  // ones unset: missing or null, as the driver stores undefined.
  removeConversationCredentialIds: async (sessionId, _userId, _teamId, pull, narrow) => {
    const stored = selections.get(sessionId) ?? {}
    const isList = (key: string) => Array.isArray(stored[key as keyof AgentCredentialAccess])

    if (Object.keys(pull).some((key) => !isList(key)) || Object.keys(narrow).some(isList))
      return null
    removals.push({ sessionId, pull, narrow })
    const next = { ...stored, ...narrow } as Record<string, unknown>

    for (const [key, ids] of Object.entries(pull))
      next[key] = (next[key] as string[]).filter((id) => !ids.includes(id))
    selections.set(sessionId, next as Partial<AgentCredentialAccess>)

    return {} as AgentConversation
  },
  getConversationWithMessages: async (sessionId) => ({
    conversation: { ...source, sessionId },
    messages: [],
  }),
})

describe('conversation-scoped thread tools', () => {
  test('creates a visible conversation with the same principal, runtime and credentials, then starts it', async () => {
    const result = await createAgentThread(actor, 'Wait for CI', 'CI watcher')

    expect(result.status).toBe('queued')
    expect(result.sourceThreadId).toBe('source')
    expect(shells[0]).toMatchObject({
      userId: 'owner',
      teamId: 'team',
      agentRuntime: 'codex',
      runtimeId: 'runtime-1',
      credentialAccess: access,
      sessionId: result.threadId,
      parentSessionId: 'source',
    })
    expect(shells[0]).not.toHaveProperty('claudeCodePreview')
    expect(claims[0]).toMatchObject({
      userId: 'owner',
      sessionId: result.threadId,
      message: { id: result.messageId, renderedText: 'Wait for CI' },
    })
    expect(claims[0]?.message.metadata).toMatchObject({
      source: 'agent.thread',
      sourceSessionId: 'source',
    })
  })

  test("a thread copies its parent's readers, never its watchers", async () => {
    Object.assign(source, {
      generalAccess: 'reply',
      participantIds: ['x', 'v'],
      watcherIds: ['owner', 'x'],
    })
    await createAgentThread(actor, 'Wait for CI', 'CI watcher')

    expect(threadReadGrants(shells[0]!.parentGrants!)).toEqual({
      generalAccess: 'view',
      participantIds: ['x', 'v'],
    })
  })

  test('a thread of a private parent stays private', async () => {
    Object.assign(source, { generalAccess: 'none' })
    await createAgentThread(actor, 'Wait for CI', 'CI watcher')

    expect(threadReadGrants(shells[0]!.parentGrants!)).toEqual({ generalAccess: 'none' })
  })

  test('returns without waiting for the turn, like a message typed into a chat', async () => {
    const runs: Parameters<TurnRunner['runAgentForTrigger']>[0][] = []

    installTurnRunner({
      claimAgentRunOrEnqueue: async (args) => {
        claims.push(args)

        return { mode: 'run', carried: [], release: () => {} }
      },
      runAgentForTrigger: (args) => {
        runs.push(args)

        // A long turn that never finishes must not hold back other threads.
        return new Promise(() => {})
      },
    })
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => createAgentThread(actor, `Task ${i}`, `Thread ${i}`)),
    )

    expect(results.map((result) => result.status)).toEqual(Array(12).fill('started'))
    for (let i = 0; i < 200 && runs.length < 12; i++) await Bun.sleep(5)
    expect(runs).toHaveLength(12)
    expect(new Set(claims.map((claim) => claim.sessionId))).toEqual(
      new Set(results.map((result) => result.threadId)),
    )
  })

  test.each([true, false])("a thread starts in its parent's mode (Full Access %p)", async (on) => {
    await setSessionBypass('source', 'owner', on)
    const result = await createAgentThread(actor, 'Work', 'Task')

    expect(await getSessionBypass(result.threadId, 'owner')).toBe(on)
  })

  test('a Full Access parent switches its thread to Auto Mode and back', async () => {
    await setSessionBypass('source', 'owner', true)
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    await updateThread(actor, threadId, { fullAccess: false })
    expect(await getSessionBypass(threadId, 'owner')).toBe(false)
    await updateThread(actor, threadId, { fullAccess: true })
    expect(await getSessionBypass(threadId, 'owner')).toBe(true)
    expect(events.map((e) => [e.conversationId, e.event])).toEqual([
      [threadId, 'auth.bypass_disabled'],
      [threadId, 'auth.bypass_enabled'],
    ])
  })

  test('an Auto Mode parent cannot give its thread Full Access, but can still lower it', async () => {
    await setSessionBypass('source', 'owner', true)
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    await setSessionBypass('source', 'owner', false)
    await expect(updateThread(actor, threadId, { fullAccess: true })).rejects.toThrow('Full Access')
    expect(await getSessionBypass(threadId, 'owner')).toBe(true)
    await updateThread(actor, threadId, { fullAccess: false })
    expect(await getSessionBypass(threadId, 'owner')).toBe(false)
  })

  test('changes any other conversation the owner has in this team, nested or not', async () => {
    await setSessionBypass('source', 'owner', true)
    selections.set('source', { deviceIds: ['mac-1'] })
    selections.set('target', {})
    await updateThread(actor, 'target', {
      fullAccess: true,
      grant: [{ provider: 'device', id: 'mac-1' }],
    })
    expect(await getSessionBypass('target', 'owner')).toBe(true)
    expect(selections.get('target')?.deviceIds).toEqual(['mac-1'])
    await expect(updateThread(actor, 'source', { fullAccess: true })).rejects.toThrow()
  })

  test('a parent grants its thread what it has selected itself, and nothing else', async () => {
    selections.set('source', {
      awsRoleIds: ['role-1'],
      linearWorkspaceIds: ['ws-1'],
      deviceIds: ['mac-1', 'offline-mac'],
    })
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    selections.set(threadId, { awsRoleIds: ['role-1'], deviceIds: [] })
    const grant = [
      { provider: 'device', id: 'mac-1' },
      // Selected but offline: the selection is what was ticked, online is checked at use.
      { provider: 'device', id: 'offline-mac' },
      { provider: 'linear', id: 'ws-1' },
      { provider: 'aws', id: 'role-1' },
    ]
    const result = await updateThread(actor, threadId, { grant })

    expect(result.granted).toEqual(grant)
    // Only the fields that change, so the thread's other choices are left alone.
    expect(writes).toEqual([
      {
        sessionId: threadId,
        fields: { linearWorkspaceIds: ['ws-1'], deviceIds: ['mac-1', 'offline-mac'] },
      },
    ])
  })

  test("refuses anything outside the parent's selection, without a write", async () => {
    selections.set('source', { awsRoleIds: ['role-1'], deviceIds: ['mac-1'] })
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    // Bound to the team but not selected here, online but not the parent's, unknown.
    for (const ref of [
      { provider: 'aws', id: 'role-2' },
      { provider: 'device', id: 'mac-2' },
      { provider: 'device', id: 'someone-elses-mac' },
      { provider: 'linear', id: 'ws-1' },
      { provider: 'gcp', id: 'role-1' },
    ]) {
      await expect(
        updateThread(actor, threadId, { grant: [{ provider: 'device', id: 'mac-1' }, ref] }),
      ).rejects.toThrow(`${ref.provider} ${ref.id}`)
    }
    expect(writes).toHaveLength(0)
  })

  test('a grant never narrows a connector whose unset selection means all', async () => {
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    await updateThread(actor, threadId, { grant: [{ provider: 'github', id: 'gh-1' }] })
    expect(writes).toHaveLength(0)
    selections.set('source', { githubInstallationIds: ['gh-1'] })
    selections.set(threadId, { githubInstallationIds: ['gh-2'] })
    await updateThread(actor, threadId, { grant: [{ provider: 'github', id: 'gh-1' }] })
    expect(selections.get(threadId)?.githubInstallationIds).toEqual(['gh-2', 'gh-1'])
    // Unset (all of them) after the thread was read: adding would narrow it, so nothing is written.
    selections.set(threadId, { githubInstallationIds: ['gh-2'] })
    getAccess = async ({ sessionId }) => {
      const read = selections.get(sessionId) ?? {}

      if (sessionId === threadId) selections.set(threadId, {})

      return read as never
    }
    await expect(
      updateThread(actor, threadId, { grant: [{ provider: 'github', id: 'gh-1' }] }),
    ).rejects.toThrow('changed meanwhile')
    expect(selections.get(threadId)).toEqual({})
  })

  test('overlapping grants to the same field keep every id', async () => {
    selections.set('source', { awsRoleIds: ['role-1', 'role-2'] })
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    selections.set(threadId, { awsRoleIds: [] })
    // Both read the thread's empty selection before either writes.
    await Promise.all(
      ['role-1', 'role-2'].map((id) =>
        updateThread(actor, threadId, { grant: [{ provider: 'aws', id }] }),
      ),
    )
    expect(selections.get(threadId)?.awsRoleIds).toEqual(['role-1', 'role-2'])
  })

  test('a thread created with a subset gets exactly that subset', async () => {
    selections.set('source', {
      awsRoleIds: ['role-1', 'role-2'],
      linearWorkspaceIds: ['ws-1'],
      deviceIds: ['mac-1', 'mac-2'],
      teamIdentity: ['github'],
      // githubInstallationIds unset: all of them.
    })
    source = { ...source, credentialAccess: { ...access, teamIdentity: ['github'] } }
    const credentials = [
      { provider: 'aws', id: 'role-2' },
      { provider: 'device', id: 'mac-1' },
      { provider: 'github', id: 'gh-1' },
    ]
    const { threadId } = await createAgentThread(actor, 'Work', 'Task', { credentials })
    const stored = shells[0]?.credentialAccess

    expect(stored).toMatchObject({
      awsRoleIds: ['role-2'],
      deviceIds: ['mac-1'],
      githubInstallationIds: ['gh-1'],
      linearWorkspaceIds: [],
      // Every field is set, so one whose unset selection means all is narrowed too.
      gitlabBindingIds: [],
      cloudflareAccountIds: [],
      teamIdentity: ['github'],
      updatedBy: 'owner',
    })
    // What its list_credentials, and so get_credential, then sees.
    selections.set(threadId, stored as never)
    const listed = await listSessionCredentials({ userId: 'owner', sessionId: threadId }, 'team')

    expect(listed.selected.map(({ provider, id }) => ({ provider, id }))).toEqual([
      { provider: 'aws', id: 'role-2' },
      { provider: 'github', id: 'gh-1' },
      { provider: 'device', id: 'mac-1' },
    ])
  })

  test('a thread created with an empty subset gets nothing, and without one inherits all', async () => {
    selections.set('source', { awsRoleIds: ['role-1'], deviceIds: ['mac-1'] })
    await createAgentThread(actor, 'Work', 'Task', { credentials: [] })
    await createAgentThread(actor, 'Work', 'Task')
    selections.set('empty', shells[0]?.credentialAccess as never)

    expect(
      (await listSessionCredentials({ userId: 'owner', sessionId: 'empty' }, 'team')).selected,
    ).toEqual([])
    expect(shells[1]?.credentialAccess).toBe(access)
  })

  test('a conversation with no selection can still create threads, within its own reach', async () => {
    source = { ...source, credentialAccess: undefined }
    const list = (sessionId: string) =>
      listSessionCredentials({ userId: 'owner', sessionId }, 'team').then(
        ({ selected }) => selected,
      )
    const inherited = await createAgentThread(actor, 'Work', 'Task')
    const none = await createAgentThread(actor, 'Work', 'Task', { credentials: [] })

    for (const shell of shells) selections.set(shell.sessionId, shell.credentialAccess as never)
    // Unset is the parent's own selection, so the thread lists exactly what the parent does.
    expect(shells[0]?.credentialAccess).toBeUndefined()
    expect(await list(inherited.threadId)).toEqual(await list('source'))
    expect(await list(none.threadId)).toEqual([])
  })

  test("create_thread refuses anything outside the parent's selection, before any write", async () => {
    selections.set('source', { awsRoleIds: ['role-1'], deviceIds: ['mac-1'] })
    for (const ref of [
      { provider: 'aws', id: 'role-2' },
      { provider: 'device', id: 'mac-2' },
      { provider: 'linear', id: 'ws-1' },
      { provider: 'gcp', id: 'role-1' },
    ]) {
      await expect(
        createAgentThread(actor, 'Work', 'Task', {
          credentials: [{ provider: 'aws', id: 'role-1' }, ref],
        }),
      ).rejects.toThrow(`${ref.provider} ${ref.id}`)
    }
    expect(shells).toHaveLength(0)
    expect(claims).toHaveLength(0)
  })

  test('a parent revokes what its thread has, leaving the rest of the selection', async () => {
    selections.set('source', { awsRoleIds: ['role-1', 'role-2'], deviceIds: ['mac-1'] })
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    selections.set(threadId, { awsRoleIds: ['role-1', 'role-2'], deviceIds: ['mac-1'] })
    const revoke = [
      { provider: 'aws', id: 'role-1' },
      { provider: 'device', id: 'mac-1' },
    ]
    const result = await updateThread(actor, threadId, { revoke })

    expect(result).toMatchObject({ revoked: revoke })
    expect(result).not.toHaveProperty('granted')
    expect(removals).toEqual([
      {
        sessionId: threadId,
        pull: { awsRoleIds: ['role-1'], deviceIds: ['mac-1'] },
        narrow: {},
      },
    ])
    expect(selections.get(threadId)).toEqual({ awsRoleIds: ['role-2'], deviceIds: [] })
  })

  test('revoking from a connector whose unset selection means all keeps the rest', async () => {
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    selections.set(threadId, {})
    await updateThread(actor, threadId, { revoke: [{ provider: 'github', id: 'gh-1' }] })
    expect(selections.get(threadId)).toEqual({ githubInstallationIds: ['gh-2'] })
    // Set to an explicit list after the thread was read: nothing is written.
    selections.set(threadId, {})
    getAccess = async ({ sessionId }) => {
      const read = selections.get(sessionId) ?? {}

      if (sessionId === threadId) selections.set(threadId, { githubInstallationIds: ['gh-1'] })

      return read as never
    }
    await expect(
      updateThread(actor, threadId, { revoke: [{ provider: 'github', id: 'gh-2' }] }),
    ).rejects.toThrow('changed meanwhile')
    expect(selections.get(threadId)).toEqual({ githubInstallationIds: ['gh-1'] })
  })

  test('a null selection, as the driver stores undefined, is revoked from as all', async () => {
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    selections.set(threadId, { githubInstallationIds: null } as never)
    await updateThread(actor, threadId, { revoke: [{ provider: 'github', id: 'gh-1' }] })
    expect(removals.at(-1)).toMatchObject({ pull: {}, narrow: { githubInstallationIds: ['gh-2'] } })
    expect(selections.get(threadId)).toEqual({ githubInstallationIds: ['gh-2'] })
  })

  test('refuses to revoke what the thread does not have, or to grant and revoke one pair', async () => {
    selections.set('source', { awsRoleIds: ['role-1', 'role-2'] })
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    selections.set(threadId, { awsRoleIds: ['role-1'] })
    await expect(
      updateThread(actor, threadId, {
        revoke: [
          { provider: 'aws', id: 'role-1' },
          { provider: 'aws', id: 'role-2' },
        ],
      }),
    ).rejects.toThrow('Not selected for the thread: aws role-2')
    const ref = { provider: 'aws', id: 'role-2' }

    await expect(updateThread(actor, threadId, { grant: [ref], revoke: [ref] })).rejects.toThrow(
      'Both granted and revoked: aws role-2',
    )
    // A refused grant in the same call stops the revoke too.
    await expect(
      updateThread(actor, threadId, {
        grant: [{ provider: 'linear', id: 'ws-1' }],
        revoke: [{ provider: 'aws', id: 'role-1' }],
      }),
    ).rejects.toThrow('linear ws-1')
    expect(writes).toHaveLength(0)
    expect(removals).toHaveLength(0)
    expect(selections.get(threadId)).toEqual({ awsRoleIds: ['role-1'] })
  })

  test("never grants to another owner's conversation, even one nested here", async () => {
    selections.set('source', { deviceIds: ['mac-1'] })
    const grant = [{ provider: 'device', id: 'mac-1' }]

    target = { ...target, parentSessionId: 'source', userId: 'other' }
    await expect(updateThread(actor, 'target', { grant })).rejects.toThrow('you own')
    expect(writes).toHaveLength(0)
  })

  test("a thread never moves onto the owner's computer", async () => {
    await setSessionBypass('source', 'owner', true)
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    await expect(updateThread(actor, threadId, { runtimeId: 'local-1' })).rejects.toThrow(
      'computer',
    )
    expect(moves).toHaveLength(0)
  })

  test('a parent moves its thread to another agent through the shared move path', async () => {
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')
    const result = await updateThread(actor, threadId, { runtimeId: 'runtime-2' })

    expect(moves).toEqual([{ sessionId: threadId, runtimeId: 'runtime-2', userId: 'owner' }])
    expect(result.runtime?.runtimeId).toBe('runtime-2')
  })

  test('moves an owned conversation that is not nested here, e.g. one past its usage limit', async () => {
    await updateThread(actor, 'target', { runtimeId: 'runtime-2' })

    expect(moves).toEqual([{ sessionId: 'target', runtimeId: 'runtime-2', userId: 'owner' }])
  })

  test("lists the team's agents and the owner's Boxes, never a computer", async () => {
    const { runtimes } = await listThreadRuntimes(actor)

    expect(runtimes.map((runtime) => runtime.runtimeId)).toEqual(['runtime-2', 'box-1'])
  })

  test('lists the models each agent offers, so a delegating agent can choose one', async () => {
    const { runtimes } = await listThreadRuntimes(actor)

    expect(runtimes[0]?.models).toEqual([
      { id: 'gpt-5.5', name: 'GPT-5.5', description: 'Strongest' },
    ])
    // An agent that cannot list its models is still listed, without them.
    expect(runtimes[1]).not.toHaveProperty('models')
  })

  test('a parent moves its thread onto a Box', async () => {
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    await updateThread(actor, threadId, { runtimeId: 'box-1' })
    expect(moves.map((move) => move.runtimeId)).toEqual(['box-1'])
  })

  test("sets a thread's model, then its effort, through the model picker", async () => {
    const { threadId } = await createAgentThread(actor, 'Work', 'Task', {
      model: 'claude-fable-5-1',
    })

    expect(picks).toEqual([{ sessionId: threadId, configId: 'model', value: 'claude-fable-5-1' }])
    const result = await updateThread(actor, threadId, { effort: 'high', model: 'default' })

    expect(picks.slice(1).map((pick) => pick.configId)).toEqual(['model', 'effort'])
    expect(result.model).toEqual({ model: 'default', effort: 'high' })
  })

  test('refuses a model the agent does not offer, naming the choices', async () => {
    await expect(createAgentThread(actor, 'Work', 'Task', { model: 'gpt-1' })).rejects.toThrow(
      'claude-fable-5-1, default',
    )
    // Nothing ran; the unused conversation is archived.
    expect(claims).toHaveLength(0)
    expect(archives).toEqual([[shells[0]?.sessionId, true]])
  })

  test('send returns the delivered message id', async () => {
    const result = await sendAgentThreadMessage(actor, 'target', 'CI passed')

    expect(claims).toHaveLength(1)
    expect(result.messageId).toBe(claims[0]!.message.id)
  })

  test.each([
    ['another owner', { userId: 'teammate' }],
    ['another team', { teamId: 'other-team' }],
  ])('refuses %s', async (_, change) => {
    Object.assign(target, change)
    await expect(sendAgentThreadMessage(actor, 'target', 'Do work')).rejects.toThrow()
    await Bun.sleep(20)
    expect(claims).toHaveLength(0)
  })

  test('delivers to an archived thread, whose turn then restores it', async () => {
    target.archivedAt = new Date()
    await sendAgentThreadMessage(actor, 'target', 'Do work')
    expect(claims).toHaveLength(1)
  })

  test('delivers to an own thread with another runtime or credential selection', async () => {
    Object.assign(target, {
      runtimeId: 'other-runtime',
      agentRuntime: 'claude-code',
      credentialAccess: { ...access, awsRoleIds: ['role-1', 'role-2'] },
    })
    await sendAgentThreadMessage(actor, 'target', 'Do work')
    expect(claims).toHaveLength(1)
  })

  test('refuses self-delivery, unknown targets and non-owner source sessions', async () => {
    await expect(sendAgentThreadMessage(actor, 'source', 'Loop')).rejects.toThrow()
    await expect(sendAgentThreadMessage(actor, 'missing', 'Work')).rejects.toThrow()
    source.userId = 'teammate'
    await expect(createAgentThread(actor, 'Work', 'Task')).rejects.toThrow()
  })

  test('rechecks membership and ownership when the turn starts', async () => {
    const data = { ...actor, targetSessionId: 'target', messageId: 'delivery', prompt: 'Work' }

    member = false
    await expect(authorizeThreadDelivery(data)).rejects.toThrow()
    member = true
    target.userId = 'teammate'
    await expect(authorizeThreadDelivery(data)).rejects.toThrow()
  })
})

describe('archive thread', () => {
  test('archives and restores an owned thread, including the current one', async () => {
    expect(await setAgentThreadArchived(actor, 'target', true)).toMatchObject({
      threadId: 'target',
      archived: true,
    })
    target.archivedAt = new Date()
    await setAgentThreadArchived(actor, 'target', false)
    await setAgentThreadArchived(actor, 'source', true)
    expect(archives).toEqual([
      ['target', true],
      ['target', false],
      ['source', true],
    ])
  })
  test('rejects missing, foreign-owner and cross-team targets without a write', async () => {
    await expect(setAgentThreadArchived(actor, 'missing', true)).rejects.toThrow('Target must')
    target.userId = 'other'
    await expect(setAgentThreadArchived(actor, 'target', true)).rejects.toThrow('Target must')
    target.userId = actor.userId
    target.teamId = 'other-team'
    await expect(setAgentThreadArchived(actor, 'target', false)).rejects.toThrow('Target must')
    expect(archives).toEqual([])
  })
  test('rejects an actor who left the team', async () => {
    member = false
    await expect(setAgentThreadArchived(actor, 'target', true)).rejects.toThrow('still belong')
    expect(archives).toEqual([])
  })
})
