import { expect, test } from 'bun:test'

import { applyImportBatch, newImportBatch } from './batch'
import { botBundleSchema } from './manifest'

const template = () => ({
  format: 'nuphos-bot-bundle',
  version: 1,
  source: {
    application: 'nuphos-template' as const,
    templateId: 'research-desk',
    version: '1.0.0',
  },
  requirements: [{ provider: 'github', required: true, reason: 'Read repository issues' }],
  bots: [{ key: 'research', name: 'Research', instructions: 'Write cited briefs.' }],
})

test('template profile preserves versioned origin and dependency requirements', () => {
  const parsed = botBundleSchema.parse(template())

  expect(parsed.source).toEqual(template().source)
  expect(parsed.requirements).toEqual(template().requirements)
})

test('template profile rejects private payloads and multiple bots', () => {
  const value = template()

  for (const extra of [
    { bots: [...value.bots, { key: 'other', name: 'Other' }] },
    { bots: [{ ...value.bots[0], memories: ['Private fact'] }] },
    { bots: [{ ...value.bots[0], files: [{ path: 'notes.txt', destination: 'notes.txt' }] }] },
    { chats: [{ key: 'group', name: 'Group', members: ['research'] }] },
    { requirements: [{ ...value.requirements[0], connectionId: 'private-binding' }] },
    { source: { ...value.source, runtimeId: 'private-runtime' } },
  ])
    expect(botBundleSchema.safeParse({ ...value, ...extra }).success).toBe(false)
})

test('template skills must identify a maintained package version', () => {
  const value = template()
  const bot = { ...value.bots[0], skills: [{ key: 'research', directory: 'skills/research' }] }

  expect(botBundleSchema.safeParse({ ...value, bots: [bot] }).success).toBe(false)
  expect(
    botBundleSchema.safeParse({
      ...value,
      bots: [{ ...bot, skills: [{ ...bot.skills[0], version: '1.0.0' }] }],
    }).success,
  ).toBe(true)
})

test('template apply forces inactive routines and retries the same destination without duplicating', async () => {
  const value = template()
  const manifest = botBundleSchema.parse({
    ...value,
    bots: [
      {
        ...value.bots[0],
        schedules: [
          {
            key: 'daily',
            name: 'Daily',
            prompt: 'Summarize issues',
            requestedEnabled: true,
            timeZone: 'Asia/Taipei',
            schedule: { kind: 'cron', expression: '0 9 * * *' },
          },
        ],
      },
    ],
  })
  const owner = { userId: 'alice', teamId: 'team', runtimeId: 'runtime', agentRuntime: 'codex' }
  const batch = newImportBatch(owner, 'digest', manifest)
  const selection = { botKeys: ['research'], chatKeys: [], enableSchedules: true }
  const calls: string[] = []
  let fail = true
  const operations = {
    checkAccess: async () => {},
    save: async () => {},
    bot: async (_source: unknown, item: { sessionId: string }, enabled: boolean) => {
      expect(enabled).toBe(false)
      calls.push(item.sessionId)
      if (fail) throw new Error('temporary failure')

      return []
    },
    chat: async () => [],
  }

  expect(calls).toEqual([])
  await applyImportBatch(batch, owner, selection, operations)
  fail = false
  await applyImportBatch(batch, owner, selection, operations)
  await applyImportBatch(batch, owner, selection, operations)
  expect(calls).toEqual([batch.items[0]!.sessionId, batch.items[0]!.sessionId])
  const copy = newImportBatch(owner, 'digest', manifest, 'deliberate-copy')

  expect(copy.id).not.toBe(batch.id)
  expect(copy.items[0]!.sessionId).not.toBe(batch.items[0]!.sessionId)
})
