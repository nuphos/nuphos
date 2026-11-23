import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useArchiveCleanup } from '@/lib/test/doubles/archive-cleanup'
import { useConversationChatRoute } from '@/lib/test/doubles/conversation-chat-route'
import { useConversationRuntimeMove } from '@/lib/test/doubles/conversation-runtime-move'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'
import { useRuntimeModels } from '@/lib/test/doubles/runtime-models'
import { useSessionConfig } from '@/lib/test/doubles/session-config'

import { getSessionBypass, setSessionBypass } from './auto-mode/store'
import { threadReadGrants } from './db/access'
import { clearPendingUserMessages } from './pending-messages'
import {
  authorizeThreadDelivery,
  createAgentThread,
  delegationThreadId,
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
// Who each settings change says made it.
const changers: unknown[] = []
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
  picks.length = 0
  changers.length = 0
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

useArchiveCleanup({ cleanUpArchived: async () => {} })
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

// The conversations the mode is resolved through: a thread runs in its parent's.
const conversations = {
  findOne: ({ sessionId }: { sessionId: string }) =>
    Promise.resolve(
      [source, target, ...shells].find((conversation) => conversation.sessionId === sessionId) ??
        null,
    ),
}

useDb({
  db: () => ({
    collection: (name: string) => ({
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
      ...(name === 'agent_conversations' ? conversations : {}),
    }),
  }),
})
useConversationRuntimeMove({
  moveConversationRuntime: async (conversation, runtimeId, userId, options) => {
    moves.push({ sessionId: conversation.sessionId, runtimeId, userId })
    changers.push(options?.by)

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
      kind: 'external',
      createdAt: '',
    },
    ...(userId
      ? [
          {
            id: 'local-1',
            provider: 'codex' as const,
            label: "Teammate's Mac",
            status: 'active' as const,
            kind: 'local' as const,
            local: { shared: { level: 'full' } },
            createdAt: '',
          },
          {
            id: 'mac-1',
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
  conversationSessionConfig: async (conversation, selection, _viewer, by) => {
    if (selection) changers.push(by)
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
const installAgentDb = useAgentDb({
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
  agentMessages: () => ({ findOne: async () => null, find: () => ({ toArray: async () => [] }) }),
  recordAgentEvent: (event) => {
    events.push(event)
  },
  getConversationWithMessages: async (sessionId) => ({
    conversation: { ...source, sessionId },
    messages: [],
  }),
})

test('a delegation key is stable and scoped to its parent, owner and team', () => {
  const id = delegationThreadId(actor, 'request-1')

  expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-a[\da-f]{3}-[\da-f]{12}$/)
  expect(delegationThreadId(actor, 'request-1')).toBe(id)
  for (const changed of [{ sessionId: 'elsewhere' }, { userId: 'other' }, { teamId: 'other' }])
    expect(delegationThreadId({ ...actor, ...changed }, 'request-1')).not.toBe(id)
})

test('retrying a delegation preserves its task and delivery id; changed prompts are refused', async () => {
  let stored: AgentConversation | undefined

  installAgentDb({
    upsertConversationShell: async (data) => {
      if (stored) return { isNew: false }
      stored = { ...source, ...data }

      return { isNew: true }
    },
    getConversationBySessionId: async (id) =>
      id === 'source' ? source : stored?.sessionId === id ? stored : null,
    agentConversations: () => ({
      findOne: async ({ sessionId }: { sessionId: string }) =>
        sessionId === actor.sessionId ? source : stored,
      updateOne: async () => {
        stored!.delegation!.ready = true

        return { matchedCount: 1 }
      },
    }),
  })
  const first = await createAgentThread(actor, 'Work', 'Task', { requestId: 'request-1' })
  const retry = await createAgentThread(actor, 'Work', 'Task', { requestId: 'request-1' })

  expect(retry.threadId).toBe(first.threadId)
  expect(retry.messageId).toBe(first.messageId)
  await expect(
    createAgentThread(actor, 'Different work', 'Task', { requestId: 'request-1' }),
  ).rejects.toThrow('different or archived work')
  expect(stored?.firstMessage).toBe('Work')
})

describe('conversation-scoped thread tools', () => {
  test('creates a visible conversation with the same principal and runtime, then starts it', async () => {
    const result = await createAgentThread(actor, 'Wait for CI', 'CI watcher')

    expect(result.status).toBe('queued')
    expect(result.sourceThreadId).toBe('source')
    expect(shells[0]).toMatchObject({
      userId: 'owner',
      teamId: 'team',
      agentRuntime: 'codex',
      runtimeId: 'runtime-1',
      sessionId: result.threadId,
      parentSessionId: 'source',
    })
    // It uses its parent's selection, so it stores none of its own.
    expect(shells[0]).not.toHaveProperty('credentialAccess')
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

  test("a thread runs in its parent's mode and follows it when it changes", async () => {
    await setSessionBypass('source', 'owner', true)
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    expect(await getSessionBypass(threadId, 'owner')).toBe(true)
    // Nothing is stored for the thread itself.
    expect([...bypass.keys()]).toEqual(['owner:source'])
    await setSessionBypass('source', 'owner', false)
    expect(await getSessionBypass(threadId, 'owner')).toBe(false)
  })

  test("a thread's mode cannot be changed on the thread, and nothing else changes with it", async () => {
    await setSessionBypass('source', 'owner', true)
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    await expect(
      updateThread(actor, threadId, { fullAccess: false, runtimeId: 'runtime-2' }),
    ).rejects.toThrow("its Bot's permission mode")
    expect(await getSessionBypass(threadId, 'owner')).toBe(true)
    expect(moves).toHaveLength(0)
    expect(events).toEqual([])
  })

  test('changes any other conversation the owner has in this team, nested or not', async () => {
    await expect(updateThread(actor, 'target', { fullAccess: true })).rejects.toThrow('Full Access')
    await setSessionBypass('source', 'owner', true)
    await updateThread(actor, 'target', { fullAccess: true })
    expect(await getSessionBypass('target', 'owner')).toBe(true)
    await expect(updateThread(actor, 'source', { fullAccess: true })).rejects.toThrow()
  })

  test("a thread never moves onto a teammate's computer", async () => {
    await setSessionBypass('source', 'owner', true)
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    await expect(updateThread(actor, threadId, { runtimeId: 'local-1' })).rejects.toThrow(
      "teammate's computer",
    )
    expect(moves).toHaveLength(0)
  })

  test("a parent moves its thread onto the owner's own computer", async () => {
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    await updateThread(actor, threadId, { runtimeId: 'mac-1' })
    expect(moves.map((move) => move.runtimeId)).toEqual(['mac-1'])
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

  test("lists every agent, and why a thread cannot use a teammate's computer", async () => {
    const { runtimes } = await listThreadRuntimes(actor)

    expect(runtimes.map(({ runtimeId, ready }) => [runtimeId, ready])).toEqual([
      ['runtime-2', true],
      ['local-1', false],
      ['mac-1', true],
      ['box-1', true],
    ])
    expect(runtimes[1]?.unavailable).toContain("teammate's computer")
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

  test("with nothing picked, a thread starts on its parent's model and effort", async () => {
    source.initialSessionConfig = { model: 'claude-fable-5-1', effort: 'high' }
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    expect(picks).toEqual([
      { sessionId: threadId, configId: 'model', value: 'claude-fable-5-1' },
      { sessionId: threadId, configId: 'effort', value: 'high' },
    ])
    // A parent that has run reads its settings from its session, as its model picker does.
    picks.length = 0
    source.claudeCodePreview = {
      openabSessionId: 'live',
      runtimeUrl: 'http://runtime',
      runtimeDefaults: { model: 'claude-fable-5-1' },
    }
    await createAgentThread(actor, 'Work', 'Task')
    expect(picks.map((pick) => pick.value)).toEqual(['claude-fable-5-1'])
  })

  test("a pick, or another agent, wins over the parent's model", async () => {
    source.initialSessionConfig = { model: 'claude-fable-5-1' }
    await createAgentThread(actor, 'Work', 'Task', { effort: 'low' })
    await createAgentThread(actor, 'Work', 'Task', { runtimeId: 'box-1' })

    expect(picks.map(({ configId, value }) => [configId, value])).toEqual([['effort', 'low']])
  })

  test("a parent on Claude Code's Default passes on its effort, and leaves the model to the agent", async () => {
    // A session on "Default (recommended)" reports `default`; the catalog lists the model it
    // stands for instead (#3709, production 2026-11-19 05:08:46Z: parent_model_failed).
    offered.model = ['claude-fable-5-1']
    source.claudeCodePreview = {
      openabSessionId: 'live',
      runtimeUrl: 'http://runtime',
      runtimeDefaults: { model: 'default', effort: 'high' },
    } as never
    try {
      const { threadId } = await createAgentThread(actor, 'Work', 'Task')

      expect(picks).toEqual([{ sessionId: threadId, configId: 'effort', value: 'high' }])
    } finally {
      offered.model = ['claude-fable-5-1', 'default']
    }
  })

  test("a parent's model the agent no longer offers leaves the thread on its defaults", async () => {
    source.initialSessionConfig = { model: 'gpt-1' }
    await createAgentThread(actor, 'Work', 'Task')

    expect(picks).toEqual([])
    expect(archives).toEqual([])
    expect(claims).toHaveLength(1)
  })

  test("a parent's effort the thread's model does not offer is left to the agent, and the rest carries over", async () => {
    const speeds = offered as Record<string, string[]>

    speeds.fast = ['on', 'off']
    source.initialSessionConfig = { model: 'claude-fable-5-1', effort: 'max', fast: 'on' }
    try {
      const { threadId } = await createAgentThread(actor, 'Work', 'Task')

      expect(picks).toEqual([
        { sessionId: threadId, configId: 'model', value: 'claude-fable-5-1' },
        { sessionId: threadId, configId: 'fast', value: 'on' },
      ])
      expect(archives).toEqual([])
    } finally {
      delete speeds.fast
    }
  })

  test('starts a thread on the agent it names, with no first turn on its parent', async () => {
    await createAgentThread(actor, 'Work', 'Task', { runtimeId: 'box-1' })

    expect(shells[0]).toMatchObject({
      runtimeId: 'box-1',
      runtimeLabel: 'Claude Code in Box',
      agentRuntime: 'claude-code',
    })
    expect(claims).toHaveLength(1)
    expect(moves).toHaveLength(0)
  })

  test("a thread never starts on a teammate's computer", async () => {
    await expect(
      createAgentThread(actor, 'Work', 'Task', { runtimeId: 'local-1' }),
    ).rejects.toThrow("teammate's computer")
    expect(shells).toHaveLength(0)
  })

  test("sets a thread's fast mode after its model and effort", async () => {
    const speeds = offered as Record<string, string[]>

    speeds.fast = ['on', 'off']
    try {
      const { threadId } = await createAgentThread(actor, 'Work', 'Task', {
        fast: 'on',
        model: 'claude-fable-5-1',
      })

      expect(picks.map((pick) => pick.configId)).toEqual(['model', 'fast'])
      await updateThread(actor, threadId, { fast: 'off' })
      expect(picks.at(-1)).toEqual({ sessionId: threadId, configId: 'fast', value: 'off' })
      await expect(updateThread(actor, threadId, { fast: 'ultra' })).rejects.toThrow('on, off')
    } finally {
      delete speeds.fast
    }
  })

  test('update_thread and create_thread name the calling agent and the person it acts for', async () => {
    const { threadId } = await createAgentThread(actor, 'Work', 'Task', {
      model: 'claude-fable-5-1',
    })

    expect(changers).toEqual([{ actorId: 'owner', agentSessionId: 'source', via: 'create_thread' }])
    changers.length = 0
    await updateThread(actor, threadId, { runtimeId: 'runtime-2', effort: 'high' })
    expect(changers).toEqual([
      { actorId: 'owner', agentSessionId: 'source', via: 'update_thread' },
      { actorId: 'owner', agentSessionId: 'source', via: 'update_thread' },
    ])
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

  test('send says which runtime the message runs on, for its card', async () => {
    // The thread was moved after it started: the message runs where it is now.
    Object.assign(target, { agentRuntime: 'claude-code', runtimeLabel: "Yuanlin's Box" })

    expect(await sendAgentThreadMessage(actor, 'target', 'Go')).toMatchObject({
      agentRuntime: 'claude-code',
      runtimeLabel: "Yuanlin's Box",
    })
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
