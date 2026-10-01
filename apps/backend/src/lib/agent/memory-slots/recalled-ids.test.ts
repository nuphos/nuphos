import { describe, expect, test } from 'bun:test'

import { listConversationRecalledIds } from './attribution-store'

describe('listConversationRecalledIds', () => {
  test('returns the ids already recalled in the conversation', async () => {
    const ids = await listConversationRecalledIds('conv-1', {
      lookup: () => Promise.resolve(['a', 'b', 7]),
    })

    expect(ids).toEqual(['a', 'b'])
  })

  test('fails open within its own budget when the lookup hangs', async () => {
    const started = Date.now()
    const ids = await listConversationRecalledIds('conv-1', {
      timeoutMs: 20,
      lookup: () => new Promise(() => {}),
    })

    expect(ids).toEqual([])
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})
