import { beforeEach, describe, expect, test } from 'bun:test'

import { createTurnMemoryAccumulator } from './turn-accumulator'
import { useDb } from '@/lib/test/doubles/db'

import type * as dbActual from '@/lib/db'

class FakeCollection {
  docs: Record<string, unknown>[] = []

  async updateOne(
    filter: Record<string, unknown>,
    update: { $set: Record<string, unknown> },
    options: { upsert?: boolean },
  ) {
    const existing = this.docs.find((doc) =>
      Object.entries(filter).every(([key, value]) => doc[key] === value),
    )

    if (existing) Object.assign(existing, update.$set)
    else if (options.upsert) this.docs.push({ ...filter, ...update.$set })

    return { upsertedCount: existing ? 0 : 1 }
  }

  find(filter: Record<string, unknown>) {
    const rows = this.docs.filter((doc) =>
      Object.entries(filter).every(([key, value]) => doc[key] === value),
    )

    return {
      sort: () => ({ toArray: async () => rows }),
    }
  }

  async deleteMany(filter: Record<string, unknown>) {
    this.docs = this.docs.filter(
      (doc) => !Object.entries(filter).every(([key, value]) => doc[key] === value),
    )
  }

  async createIndex() {
    return 'index'
  }
}

const collection = new FakeCollection()

useDb({
  db: (() => ({ collection: () => collection })) as unknown as typeof dbActual.db,
})

const {
  mergePreviewMemoryActivity,
  purgeConversationPreviewMemoryActivity,
  recordPreviewMemoryActivity,
  setupPreviewMemoryActivityIndexes,
} = await import('./preview-activity-store')

describe('preview memory activity store', () => {
  beforeEach(() => {
    collection.docs = []
  })

  test('durably merges the exact turn MCP activity into its accumulator', async () => {
    await recordPreviewMemoryActivity('session-1', 'request-1', 'fetched', {
      id: 'memory-1',
      scope: 'personal',
      label: 'old label',
    })
    await recordPreviewMemoryActivity('session-1', 'request-1', 'fetched', {
      id: 'memory-1',
      scope: 'personal',
      label: 'Switched t3 to m7i-flex',
    })
    await recordPreviewMemoryActivity('session-1', 'request-1', 'saved', {
      id: 'memory-2',
      scope: 'team',
      title: 'Prefer m7i-flex',
      action: 'created',
    })
    await recordPreviewMemoryActivity('session-1', 'other-turn', 'fetched', {
      id: 'wrong-turn',
      scope: 'team',
    })
    const frames: Record<string, unknown>[] = []
    const acc = createTurnMemoryAccumulator({
      providerId: 'native',
      sessionId: 'session-1',
      userId: 'user-1',
      teamId: 'team-1',
      requestId: 'request-1',
      emitFrame: (frame) => frames.push(frame),
      recordEvent: () => {},
    })

    await mergePreviewMemoryActivity(acc, 'session-1', 'request-1')

    expect(collection.docs).toHaveLength(3)
    expect(acc.view().fetchedIds).toEqual(['memory-1'])
    expect(acc.view().fetchedLabels.get('memory-1')).toBe('Switched t3 to m7i-flex')
    expect(acc.view().savedTitles).toEqual(['Prefer m7i-flex'])
    expect(frames).toEqual([])
  })

  test('supports setup and conversation erasure', async () => {
    await recordPreviewMemoryActivity('session-1', 'request-1', 'fetched', {
      id: 'memory-1',
      scope: 'personal',
    })
    await setupPreviewMemoryActivityIndexes()
    await purgeConversationPreviewMemoryActivity('session-1')

    expect(collection.docs).toEqual([])
  })
})
