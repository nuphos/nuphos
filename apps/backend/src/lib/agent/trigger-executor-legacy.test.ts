// A Trigger stored before credential modes and Full Access existed: both are
// decided per run, so the row's age must not change what it runs with.
import '@/routes/agent'

import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useCredentialOptions } from '@/lib/test/doubles/credential-options'
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
  devices: [],
} as unknown as AgentCredentialOptions

const runs: TriggerRunParams[] = []
let heldTurn: Promise<void> | undefined
let conversation: {
  sessionId: string
  teamId: string
  userId: string
  archivedAt?: Date
} | null = null
const history = [
  { messageId: 'prior', role: 'assistant', parts: [{ type: 'text', text: 'Prior finding' }] },
]

useDb({
  db: () => ({
    collection: (name: string) => ({
      updateOne: () => Promise.resolve({}),
      updateMany: () => Promise.resolve({}),
      findOne: () => Promise.resolve(name === 'agent_conversations' ? conversation : null),
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

describe('executeTrigger on a Trigger older than the credential mode', () => {
  test('runs with the team credentials as they stand now and with Full Access', async () => {
    runs.length = 0
    await executeTrigger(legacyTrigger, undefined, { runKind: 'scheduled' })

    expect(runs).toHaveLength(1)
    expect(runs[0]?.credentialAccess?.notionIntegrationIds).toEqual(['notion-late'])
    // 'trigger' is what makes the session initialize Full Access; it is read
    // off the run, never off the stored row.
    expect(runs[0]?.origin).toBe('trigger')
    // The fire is the Trigger speaking, not the owner.
    expect(runs[0]?.messages.at(-1)?.metadata).toMatchObject({
      source: 'agent.resource',
      sender: { type: 'system', id: `trigger:${legacyTrigger._id!.toHexString()}` },
    })
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

test('routed turns serialize simultaneous deliveries and preserve history', async () => {
  runs.length = 0
  const sessionId = 'stable-session'

  conversation = { sessionId, userId: PRINCIPAL_ID, teamId: 'team-1' }
  let finish!: () => void

  heldTurn = new Promise<void>((resolve) => {
    finish = resolve
  })
  const first = executeTrigger(legacyTrigger, {}, { runKind: 'webhook', sessionId })

  try {
    for (let i = 0; i < 100 && runs.length === 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 1))
    expect(runs).toHaveLength(1)
    await expect(
      executeTrigger(legacyTrigger, {}, { runKind: 'webhook', sessionId }),
    ).rejects.toThrow('busy')
    expect(runs[0]?.messages[0]?.id).toBe('prior')
    expect(runs[0]?.sessionId).toBe(sessionId)
  } finally {
    finish()
    await first
    heldTurn = undefined
    conversation = null
  }
  await executeTrigger(legacyTrigger, {}, { runKind: 'webhook', sessionId })
  expect(runs).toHaveLength(2)
})

test('routed sessions refuse an execution-principal change', async () => {
  conversation = { sessionId: 'stable-session', userId: 'another-owner', teamId: 'team-1' }
  try {
    await expect(
      executeTrigger(legacyTrigger, {}, { runKind: 'webhook', sessionId: 'stable-session' }),
    ).rejects.toThrow('owner or team')
  } finally {
    conversation = null
  }
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
    expect(runs[0]?.trigger).toBeUndefined()
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
