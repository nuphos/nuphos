import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useChannelChat } from '@/lib/test/doubles/channel-chat'
import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'
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

type Turn = { messageId: string; text: string; speaksIn?: string }
let turns: Turn[] = []
// What the Bot's turn does: speak in the chat, end silently, or never start.
let turnOutcome: 'speaks' | 'silent' | 'refused' = 'speaks'
let pendingTriggers: { botSessionId: string; triggers: unknown[] } | undefined

useAgentDb({
  getConversationBySessionId: (sessionId) =>
    Promise.resolve({ sessionId, userId: 'alice', teamId: TEAM, kind: 'channel' }),
  updateBotSelf: () => Promise.resolve(true),
  upsertConversationShell: () => Promise.resolve(),
  agentConversations: () => ({
    updateOne: (_filter: unknown, update: { $set?: { pendingCreatedTriggers?: never } }) => {
      if (update.$set?.pendingCreatedTriggers) pendingTriggers = update.$set.pendingCreatedTriggers

      return Promise.resolve({ matchedCount: 1 })
    },
    findOneAndUpdate: () => {
      const before = pendingTriggers

      pendingTriggers = undefined

      return Promise.resolve(before ? { pendingCreatedTriggers: before } : null)
    },
  }),
  agentMessages: () => ({
    findOne: (filter: { sessionId: string; 'metadata.sender.id': string }) =>
      Promise.resolve(
        posted.find(
          (p) =>
            p.channel === filter.sessionId &&
            (p.metadata as { sender?: { id?: string } }).sender?.id ===
              filter['metadata.sender.id'],
        ) ?? null,
      ),
  }),
})
useConversationTurn({
  startConversationTurn: async (data, _agent, text) => {
    if (turnOutcome === 'refused') throw new Error('runtime offline')
    // Mirrors the real dedupe: the same message id is not taken twice.
    if (turns.some((t) => t.messageId === data.messageId))
      return { status: 'queued', run: Promise.resolve() }
    turns.push({ messageId: data.messageId, text, speaksIn: data.speaksIn })
    if (turnOutcome === 'speaks')
      posted.push({
        channel: data.speaksIn!,
        id: 'bot-own-post',
        text: 'Hi from the turn',
        metadata: { sender: { type: 'agent', id: data.targetSessionId } },
        author: data.targetSessionId,
      })

    return { status: 'started', run: Promise.resolve() }
  },
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
  turns = []
  turnOutcome = 'speaks'
  pendingTriggers = undefined
})

// The fallback runs after the turn settles, on a later tick.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

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

test('a template Bot speaks first through a real turn in its private chat', async () => {
  const { item, apply } = templateImport({
    greeting: 'Hi, I am ready.',
    schedules: [routine('daily')],
  })

  await apply()
  await settle()
  // A retried apply finds the Bot already spoke and starts no second turn.
  await apply()
  await settle()

  expect(turns).toHaveLength(1)
  expect(turns[0]!.speaksIn).toBe(item.privateChatId)
  expect(turns[0]!.text).toContain('Hi, I am ready.')
  expect(turns[0]!.text).toContain('Routine daily')
  expect(posted).toHaveLength(1)
  expect(posted[0]!.id).toBe('bot-own-post')
  // Left for the Bot's own first post to carry.
  expect(pendingTriggers).toEqual({
    botSessionId: item.sessionId,
    triggers: [{ id: 'trigger-1', name: 'Routine daily' }],
  })
  expect(chatMembers).toContainEqual([item.privateChatId!, item.sessionId])
})

test('the first turn is told the template requirements', async () => {
  const manifest = botBundleSchema.parse({
    format: 'nuphos-bot-bundle',
    version: 1,
    source: { application: 'nuphos-template', templateId: 'research-desk', version: '1.0.0' },
    requirements: [{ provider: 'github', required: true, reason: 'Reads issues' }],
    bots: [{ key: 'research', name: 'Research', greeting: 'Hello.' }],
  })
  const batch = newImportBatch(owner, 'digest', manifest)
  const archive = { digest: 'digest', manifest, files: new Map(), expandedBytes: 0 }

  await importOperations(batch, archive, async () => {}).bot(
    manifest.bots[0]!,
    batch.items[0]!,
    true,
  )

  expect(turns[0]!.text).toContain('- github (required): Reads issues')
  // Unattended, the turn may only read and post in its chat: it asks rather than checks.
  expect(turns[0]!.text).toContain('ask your owner to connect them')
  expect(turns[0]!.text).not.toContain('list_credentials')
})

test('a turn that ends without a post leaves the template greeting, once, with its Triggers', async () => {
  turnOutcome = 'silent'
  const { item, apply } = templateImport({
    greeting: 'Hi, I am ready.',
    schedules: [routine('daily'), routine('weekly')],
  })

  await apply()
  await settle()
  await apply()
  await settle()

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
  expect(pendingTriggers).toBeUndefined()
})

test('a turn that cannot start leaves the template greeting at once', async () => {
  turnOutcome = 'refused'
  const { apply } = templateImport({ greeting: 'Hello.' })

  await apply()

  expect(posted).toHaveLength(1)
  expect(posted[0]!.text).toBe('Hello.')
  expect(posted[0]!.metadata).not.toHaveProperty('createdTriggers')
})

test('a template without a greeting starts no turn and posts nothing', async () => {
  const { apply } = templateImport({ schedules: [routine('daily')] })

  await apply()

  expect(turns).toHaveLength(0)
  expect(posted).toHaveLength(0)
  expect(triggers.size).toBe(1)
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
