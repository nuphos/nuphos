import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useChannelChat } from '@/lib/test/doubles/channel-chat'
import { useDbChannels } from '@/lib/test/doubles/db-channels'
import { useTriggerService } from '@/lib/test/doubles/trigger-service'

import { newImportBatch } from './batch'
import { botBundleSchema } from './manifest'

import type { BotBundleArchive } from './archive'

// Imported after the doubles above register, so operations binds to them.
const { importOperations } = await import('./operations')

type Posted = { channel: string; id: string; text: string; metadata: unknown; author?: string }

const TEAM = '0123456789abcdef01234567'
const owner = { userId: 'alice', teamId: TEAM, runtimeId: 'runtime', agentRuntime: 'codex' }
let posted: Posted[] = []
let triggers = new Map<string, { id: string; name: string }>()
let chatMembers: string[][] = []

useAgentDb({
  getConversationBySessionId: (sessionId) =>
    Promise.resolve({ sessionId, userId: 'alice', teamId: TEAM, kind: 'channel' }),
  updateBotSelf: () => Promise.resolve(true),
  upsertConversationShell: () => Promise.resolve(),
  agentConversations: () => ({ updateOne: () => Promise.resolve({ matchedCount: 1 }) }),
})
useDbChannels({
  addChannelAgent: (channel, agent) => {
    chatMembers.push([channel, agent])

    return Promise.resolve()
  },
})
useChannelChat({
  // Mirrors the real store: a message id already in the channel is not posted again.
  postChannelMessage: (channel, post, author) => {
    if (posted.some((p) => p.id === post.id)) return Promise.resolve(false)
    posted.push({ channel: channel.sessionId, ...post, author })

    return Promise.resolve(true)
  },
})
useTriggerService({
  // Mirrors the real dedupeKey: the same key returns the Trigger created before.
  createTrigger: (input) => {
    const key = input.dedupeKey ?? String(triggers.size)
    const trigger = triggers.get(key) ?? {
      id: `trigger-${String(triggers.size + 1)}`,
      name: input.name,
    }

    triggers.set(key, trigger)

    return Promise.resolve(trigger)
  },
})

beforeEach(() => {
  posted = []
  triggers = new Map()
  chatMembers = []
})

const routine = (key: string) => ({
  key,
  name: `Routine ${key}`,
  prompt: 'Summarize issues',
  requestedEnabled: true,
  timeZone: 'Asia/Taipei',
  schedule: { kind: 'cron', expression: '0 9 * * *' },
})

function templateImport(bot: Record<string, unknown>) {
  const manifest = botBundleSchema.parse({
    format: 'nuphos-bot-bundle',
    version: 1,
    source: { application: 'nuphos-template', templateId: 'research-desk', version: '1.0.0' },
    bots: [{ key: 'research', name: 'Research', instructions: 'Write cited briefs.', ...bot }],
  })
  const batch = newImportBatch(owner, 'digest', manifest)
  const archive: BotBundleArchive = {
    digest: 'digest',
    manifest,
    files: new Map(),
    expandedBytes: 0,
  }
  const operations = importOperations(batch, archive, async () => {})
  const item = batch.items[0]!
  const source = manifest.bots[0]!

  return { item, apply: () => operations.bot(source, item, true) }
}

test('a template greeting is posted once into the private chat, as the Bot, with its Triggers', async () => {
  const { item, apply } = templateImport({
    greeting: 'Hi, I am ready.',
    schedules: [routine('daily'), routine('weekly')],
  })

  await apply()
  // A retried apply reuses the same Triggers and finds the greeting already posted.
  await apply()

  expect(posted).toHaveLength(1)
  expect(posted[0]).toMatchObject({
    channel: item.privateChatId,
    text: 'Hi, I am ready.',
    author: item.sessionId,
    metadata: {
      sender: { type: 'agent', id: item.sessionId, displayName: 'Research' },
      source: 'agent.thread',
      sourceSessionId: item.sessionId,
      createdTriggers: [
        { id: 'trigger-1', name: 'Routine daily' },
        { id: 'trigger-2', name: 'Routine weekly' },
      ],
    },
  })
  expect(triggers.size).toBe(2)
  expect(chatMembers).toContainEqual([item.privateChatId!, item.sessionId])
})

test('a template without a greeting posts nothing', async () => {
  const { apply } = templateImport({ schedules: [routine('daily')] })

  await apply()

  expect(posted).toHaveLength(0)
  expect(triggers.size).toBe(1)
})

test('a greeting without Triggers carries no createdTriggers', async () => {
  const { apply } = templateImport({ greeting: 'Hello.' })

  await apply()

  expect(posted).toHaveLength(1)
  expect(posted[0]!.metadata).not.toHaveProperty('createdTriggers')
})

test('a group chat still returns only schedule warnings', async () => {
  const manifest = botBundleSchema.parse({
    format: 'nuphos-bot-bundle',
    version: 1,
    source: { application: 'grok-bot', exportedAt: '2026-11-11T00:00:00Z' },
    bots: [{ key: 'research', name: 'Research' }],
    chats: [
      {
        key: 'group',
        name: 'Group',
        members: ['research'],
        schedules: [
          routine('daily'),
          { ...routine('hourly'), schedule: { kind: 'interval', seconds: 3600 } },
        ],
      },
    ],
  })
  const batch = newImportBatch(owner, 'digest', manifest)
  const archive: BotBundleArchive = {
    digest: 'digest',
    manifest,
    files: new Map(),
    expandedBytes: 0,
  }
  const item = batch.items.find((entry) => entry.kind === 'chat')!
  const selected = { ...batch, selection: { botKeys: ['research'], chatKeys: ['group'] } }

  const warnings = await importOperations(selected as never, archive, async () => {}).chat(
    manifest.chats[0]!,
    item,
    ['bot-session'],
    undefined,
    true,
  )

  expect(warnings).toEqual(['Routine hourly: this schedule requires manual setup'])
  expect(triggers.size).toBe(1)
  expect(posted).toHaveLength(0)
})
