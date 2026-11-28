import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAutoModeStore } from '@/lib/test/doubles/auto-mode-store'
import { useChannelChat } from '@/lib/test/doubles/channel-chat'
import { useDbChannels } from '@/lib/test/doubles/db-channels'

import { newImportBatch } from './batch'
import { botBundleSchema } from './manifest'

import type { BotBundleArchive } from './archive'

// Imported after the doubles above register, so operations binds to them.
const { importOperations } = await import('./operations')

const TEAM = '0123456789abcdef01234567'
const owner = { userId: 'alice', teamId: TEAM, runtimeId: 'runtime', agentRuntime: 'codex' }
let created = new Set<string>()
let modes: { sessionId: string; userId: string; bypass: boolean }[] = []

useAgentDb({
  // A Bot exists once createBot has stored it; before that the import makes it.
  getConversationBySessionId: (sessionId) =>
    Promise.resolve(
      created.has(sessionId)
        ? { sessionId, userId: 'alice', teamId: TEAM, kind: 'channel' }
        : undefined,
    ),
  updateBotSelf: () => Promise.resolve(true),
  upsertConversationShell: (shell) => {
    created.add(shell.sessionId)

    return Promise.resolve()
  },
  agentConversations: () => ({ updateOne: () => Promise.resolve({ matchedCount: 1 }) }),
})
useAutoModeStore({
  initializeSessionBypass: (sessionId, userId, bypass) => {
    modes.push({ sessionId, userId, bypass })

    return Promise.resolve()
  },
})
useDbChannels({ addChannelAgent: () => Promise.resolve() })
useChannelChat({ postChannelMessage: () => Promise.resolve(true) })

beforeEach(() => {
  created = new Set()
  modes = []
})

function importOf(application: 'nuphos-template' | 'grok-bot') {
  const manifest = botBundleSchema.parse({
    format: 'nuphos-bot-bundle',
    version: 1,
    source:
      application === 'nuphos-template'
        ? { application, templateId: 'research-desk', version: '1.0.0' }
        : { application, exportedAt: '2026-11-25T00:00:00Z' },
    bots: [{ key: 'research', name: 'Research', instructions: 'Write cited briefs.' }],
  })
  const batch = newImportBatch(owner, 'digest', manifest)
  const archive: BotBundleArchive = {
    digest: 'digest',
    manifest,
    files: new Map(),
    expandedBytes: 0,
  }
  const item = batch.items[0]!

  return {
    item,
    apply: () =>
      importOperations(batch, archive, async () => {}).bot(manifest.bots[0]!, item, true),
  }
}

test.each(['nuphos-template', 'grok-bot'] as const)(
  'a Bot imported from %s starts in Full Access, as one made with "+" does',
  async (application) => {
    const { item, apply } = importOf(application)

    await apply()

    expect(modes).toEqual([{ sessionId: item.sessionId, userId: 'alice', bypass: true }])
  },
)

test('a retried import keeps the mode the Bot already has', async () => {
  const { apply } = importOf('nuphos-template')

  await apply()
  await apply()

  // The Bot exists by the retry, so it is not created, and its mode is not set, again.
  expect(modes).toHaveLength(1)
})
