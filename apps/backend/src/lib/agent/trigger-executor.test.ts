// Every fire delivers into the Trigger's bound conversation. A row stored
// without a Task has nowhere to go and is paused.
import '@/routes/agent'

import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useCredentialOptions } from '@/lib/test/doubles/credential-options'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useTriggerRunExecute } from '@/lib/test/doubles/trigger-run-execute'

import type { AgentCredentialAccess } from './db'
import type { AgentTrigger } from './trigger-db'
import type { TriggerRunParams } from '@/routes/agent'
import type { AgentCredentialOptions } from '@/routes/agent/types'

const options = {
  awsRoles: [],
  gcpServiceAccounts: [],
  linodeAccounts: [],
  hetznerAccounts: [],
  tencentAccounts: [],
  aliyunAccounts: [],
  volcengineAccounts: [],
  huaweiAccounts: [],
  azureAccounts: [],
  onpremClusters: [],
  betterStackIntegrations: [],
  uptimeKumaInstances: [],
  linearWorkspaces: [],
  jiraSites: [],
  asanaAccounts: [],
  sentryAccounts: [],
  tailscaleClients: [],
  zeaburProviders: [],
  vantaIntegrations: [],
  secureframeIntegrations: [],
  resendIntegrations: [],
  githubInstallations: [],
  gitlabBindings: [],
  grafanaInstances: [],
  sonarqubeIntegrations: [],
  notionIntegrations: [{ integrationId: 'notion-late', workspaceName: 'Team' }],
  upstashAccounts: [],
  posthogIntegrations: [],
  plaudAccounts: [],
  cloudflareAccounts: [],
  instaboxAccounts: [],
  devices: [],
} as unknown as AgentCredentialOptions

const runs: TriggerRunParams[] = []
let heldTurn: Promise<void> | undefined
let conversation: {
  sessionId: string
  teamId: string
  userId: string
  archivedAt?: Date
  kind?: 'channel'
  agentSessionIds?: string[]
} | null = null
const channelPosts: { sessionId: string; messages: { id: string }[] }[] = []
const triggerWrites: { $set?: Record<string, unknown> }[] = []

useAgentDb({
  appendConversationMessages: async (data) => {
    channelPosts.push(data)

    return true
  },
})
const history = [
  { messageId: 'prior', role: 'assistant', parts: [{ type: 'text', text: 'Prior finding' }] },
]

useDb({
  db: () => ({
    collection: (name: string) => ({
      updateOne: (_filter: unknown, update: { $set?: Record<string, unknown> }) => {
        if (name === 'agent_triggers') triggerWrites.push(update)

        return Promise.resolve({})
      },
      updateMany: () => Promise.resolve({}),
      findOne: (filter: { messageId?: string }) =>
        Promise.resolve(
          name === 'agent_conversations'
            ? conversation
            : name === 'agent_messages' &&
                channelPosts.some((post) =>
                  post.messages.some((message) => message.id === filter.messageId),
                )
              ? {}
              : null,
        ),
      find: () => ({ sort: () => ({ toArray: () => Promise.resolve(history) }) }),
    }),
  }),
})
useIdentity({ getTeamMembership: () => Promise.resolve({ role: 'ADMINISTRATOR' }) })
useCredentialOptions({ getAgentCredentialOptions: () => Promise.resolve(options) })
useTriggerRunExecute({
  executeAgentForTrigger: async (params) => {
    runs.push(params)
    await heldTurn

    return { status: 'completed', finishReason: 'stop' }
  },
})

const { executeTrigger } = await import('./trigger-executor')
const { startQueuedTurn } = await import('./queued-turn')
const { installQueuedTurnStarter } = await import('./session-released')

installQueuedTurnStarter(startQueuedTurn)

const PRINCIPAL_ID = new ObjectId().toHexString()

const legacyTrigger = {
  _id: new ObjectId(),
  userId: PRINCIPAL_ID,
  teamId: 'team-1',
  name: 'nightly',
  triggerType: 'cron',
  cronExpression: '0 3 * * *',
  messageTemplate: 'check the deploy',
  enabled: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  // Pinned when the Trigger was created, before Notion was connected.
  executionCredentialAccess: {
    notionIntegrationIds: [],
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedBy: PRINCIPAL_ID,
  } as unknown as AgentCredentialAccess,
} as AgentTrigger

describe('executeTrigger on a Trigger without a Task', () => {
  test('pauses it instead of opening a session', async () => {
    runs.length = 0

    await expect(
      executeTrigger(legacyTrigger, undefined, { runKind: 'scheduled' }),
    ).rejects.toMatchObject({ code: 'trigger_target_session_invalid' })
    expect(runs).toHaveLength(0)
  })
})

describe('executeTrigger on a row left by the removed database-alert feature', () => {
  test('refuses both the dedicated type and a cron row carrying the alert subdoc', async () => {
    runs.length = 0
    const retiredType = {
      ...legacyTrigger,
      triggerType: 'database-alert',
    } as unknown as AgentTrigger
    const cronWithAlert = {
      ...legacyTrigger,
      databaseAlert: { metric: 'queue-depth' },
    } as AgentTrigger

    for (const trigger of [retiredType, cronWithAlert]) {
      await expect(executeTrigger(trigger, undefined, { runKind: 'manual' })).rejects.toThrow(
        'retired database alert',
      )
    }
    expect(runs).toHaveLength(0)
  })
})

describe('a Trigger bound to an existing session', () => {
  const sessionId = 'bound-session'
  const bound = { ...legacyTrigger, targetSessionId: sessionId } as AgentTrigger
  const texts = (index: number) =>
    runs[index]?.messages.flatMap((message) =>
      message.role === 'user' ? message.parts.map((part) => (part as { text: string }).text) : [],
    )

  test('wakes the idle session as a resource event instead of opening a conversation', async () => {
    runs.length = 0
    conversation = { sessionId, userId: PRINCIPAL_ID, teamId: 'team-1' }
    try {
      expect(await executeTrigger(bound, undefined, { runKind: 'scheduled', fireId: 'f1' })).toBe(
        sessionId,
      )
    } finally {
      conversation = null
    }
    expect(runs).toHaveLength(1)
    expect(runs[0]?.sessionId).toBe(sessionId)
    // Carried on the turn so its usage is attributed to this fire; the bound
    // conversation's own metadata is never re-stamped.
    expect(runs[0]?.trigger).toEqual({
      id: bound._id!.toHexString(),
      kind: 'scheduled',
      fireId: 'f1',
    })
    expect(runs[0]?.source).toBe('agent.resource')
    expect(runs[0]?.messages[0]?.id).toBe('prior')
    expect(runs[0]?.messages.at(-1)?.metadata).toMatchObject({
      source: 'agent.resource',
      sender: { type: 'system', id: `trigger:${bound._id!.toHexString()}` },
    })
  })

  test('runs fires that arrive during a turn once, after it, coalesced', async () => {
    runs.length = 0
    conversation = { sessionId, userId: PRINCIPAL_ID, teamId: 'team-1' }
    let finish!: () => void

    heldTurn = new Promise<void>((resolve) => {
      finish = resolve
    })
    try {
      const first = executeTrigger(bound, undefined, { runKind: 'scheduled', fireId: 'a' })

      for (let i = 0; i < 100 && runs.length === 0; i++)
        await new Promise((resolve) => setTimeout(resolve, 1))
      await executeTrigger(bound, undefined, { runKind: 'scheduled', fireId: 'b' })
      await executeTrigger(bound, undefined, { runKind: 'scheduled', fireId: 'c' })
      expect(runs).toHaveLength(1)
      heldTurn = undefined
      finish()
      await first
      for (let i = 0; i < 100 && runs.length < 2; i++)
        await new Promise((resolve) => setTimeout(resolve, 1))
      expect(runs).toHaveLength(2)
      expect(texts(1)).toEqual(['check the deploy'])
    } finally {
      heldTurn = undefined
      conversation = null
    }
  })

  test('records the finished run without moving updatedAt, which means "configuration changed"', async () => {
    triggerWrites.length = 0
    conversation = { sessionId, userId: PRINCIPAL_ID, teamId: 'team-1' }
    try {
      await executeTrigger(bound, undefined, { runKind: 'scheduled', fireId: 'done' })
    } finally {
      conversation = null
    }
    const lastRunWrite = triggerWrites.find((write) => write.$set && 'lastRunAt' in write.$set)

    expect(lastRunWrite?.$set).toBeDefined()
    expect(lastRunWrite?.$set).not.toHaveProperty('updatedAt')
  })

  test('wakes an archived session, whose turn then restores it', async () => {
    runs.length = 0
    conversation = { sessionId, userId: PRINCIPAL_ID, teamId: 'team-1', archivedAt: new Date() }
    try {
      await executeTrigger(bound, undefined, { runKind: 'scheduled', fireId: 'archived' })
    } finally {
      conversation = null
    }
    expect(runs).toHaveLength(1)
    expect(runs[0]?.sessionId).toBe(sessionId)
  })

  test('pauses instead of firing when the session is gone', async () => {
    runs.length = 0
    await expect(executeTrigger(bound, undefined, { runKind: 'scheduled' })).rejects.toThrow(
      'The Trigger was paused',
    )
    expect(runs).toHaveLength(0)
  })
})

test('a bound channel Trigger posts once to the shared chat instead of running the channel as an agent', async () => {
  channelPosts.length = 0
  runs.length = 0
  const sessionId = 'imported-shared-chat'

  conversation = {
    sessionId,
    userId: PRINCIPAL_ID,
    teamId: 'team-1',
    kind: 'channel',
    agentSessionIds: [],
  }
  try {
    const trigger = { ...legacyTrigger, targetSessionId: sessionId }

    await executeTrigger(trigger, undefined, { runKind: 'scheduled', fireId: 'same-fire' })
    await executeTrigger(trigger, undefined, { runKind: 'scheduled', fireId: 'same-fire' })
    expect(channelPosts).toHaveLength(1)
    expect(channelPosts[0]?.sessionId).toBe(sessionId)
    expect(runs).toHaveLength(0)
  } finally {
    conversation = null
    channelPosts.length = 0
  }
})
