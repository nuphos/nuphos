import { expect, test } from 'bun:test'

import { applyImportBatch, assertImportOwner, importBatchId, newImportBatch } from './batch'
import { botBundleSchema } from './manifest'

import type { ImportOperations, ImportOwner } from './batch'

const owner: ImportOwner = {
  userId: 'alice',
  teamId: 'team-a',
  runtimeId: 'computer-a',
  agentRuntime: 'codex',
}
const manifest = () =>
  botBundleSchema.parse({
    format: 'nuphos-bot-bundle',
    version: 1,
    source: { application: 'grok-bot', exportedAt: '2026-11-11T00:00:00Z' },
    bots: [
      { key: 'research', name: 'Research' },
      { key: 'writer', name: 'Writer' },
    ],
    chats: [{ key: 'desk', name: 'Desk', members: ['research', 'writer'], lead: 'writer' }],
  })
const selection = { botKeys: ['research', 'writer'], chatKeys: ['desk'], enableSchedules: false }

function operations(): ImportOperations {
  return {
    checkAccess: async () => {},
    save: async () => {},
    bot: async () => [],
    chat: async () => [],
  }
}

test('batch identity binds owner, team, runtime, provider and explicit copies', () => {
  const id = importBatchId(owner, 'digest')

  expect(importBatchId(owner, 'digest')).toBe(id)
  for (const field of ['userId', 'teamId', 'runtimeId', 'agentRuntime'] as const)
    expect(importBatchId({ ...owner, [field]: 'other' }, 'digest')).not.toBe(id)
  expect(importBatchId(owner, 'digest', 'new-copy')).not.toBe(id)
})

test('foreign owners and malformed selections cannot start writes', async () => {
  const batch = newImportBatch(owner, 'digest', manifest())
  const writes: string[] = []
  const ops = {
    ...operations(),
    bot: async () => {
      writes.push('write')

      return []
    },
  }

  expect(() => assertImportOwner(batch, { ...owner, teamId: 'other' })).toThrow()
  await expect(
    applyImportBatch(batch, owner, { ...selection, botKeys: ['research', 'research'] }, ops),
  ).rejects.toThrow()
  await expect(
    applyImportBatch(batch, { ...owner, userId: 'bob' }, selection, ops),
  ).rejects.toThrow()
  expect(writes).toEqual([])
})

test('partial failure keeps successes, maps only selected imported members and retries failed items', async () => {
  const batch = newImportBatch(owner, 'digest', manifest())
  const calls: string[] = []
  let failed = true
  const ops: ImportOperations = {
    ...operations(),
    bot: async (source, item) => {
      calls.push(item.sessionId)
      if (source.key === 'writer' && failed) throw new Error('sensitive provider exception')

      return []
    },
    chat: async (_source, _item, members, lead, enable) => {
      expect(members).toEqual(
        failed
          ? [batch.items[0]!.sessionId]
          : [batch.items[0]!.sessionId, batch.items[1]!.sessionId],
      )
      expect(lead).toBe(failed ? undefined : batch.items[1]!.sessionId)
      expect(enable).toBe(false)

      return []
    },
  }

  await applyImportBatch(batch, owner, selection, ops)
  expect(batch.items.map((item) => item.state)).toEqual(['applied', 'failed', 'applied'])
  expect(batch.items[1]!.error).not.toContain('sensitive')
  expect(batch.items[2]!.warnings).toContain('The original lead was not imported')
  failed = false
  await applyImportBatch(batch, owner, selection, ops)
  expect(calls).toEqual([
    batch.items[0]!.sessionId,
    batch.items[1]!.sessionId,
    batch.items[1]!.sessionId,
  ])
})

test('revoked access stops the batch before another object is created', async () => {
  const batch = newImportBatch(owner, 'digest', manifest())
  let checks = 0
  let writes = 0

  await expect(
    applyImportBatch(batch, owner, selection, {
      ...operations(),
      checkAccess: async () => {
        if (++checks === 3) throw new Error('revoked')
      },
      bot: async () => {
        writes++

        return []
      },
    }),
  ).rejects.toThrow('revoked')
  expect(writes).toBe(1)
  expect(batch.items[0]!.state).toBe('applied')
})
