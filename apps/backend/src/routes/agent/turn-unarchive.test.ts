import { describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { restoreArchivedForTurn, restoreArchivedSession } from './turn-unarchive'

import type * as dbActual from '@/lib/db'

let restores = 0
let updateOne: () => Promise<{ modifiedCount: number }> = () => {
  restores++

  return Promise.resolve({ modifiedCount: 1 })
}

useDb({
  db: (() => ({
    collection: () => ({ updateOne: () => updateOne() }),
  })) as unknown as typeof dbActual.db,
})

const archived = { sessionId: 's1', archivedAt: new Date('2026-09-01T00:00:00Z') }
const active = { sessionId: 's2' }

describe('restoreArchivedForTurn', () => {
  test('any turn brings an archived conversation back, a resource or Trigger event too', async () => {
    restores = 0
    await restoreArchivedForTurn(archived, 'user')
    await restoreArchivedForTurn(archived, 'trigger')
    expect(restores).toBe(2)
  })

  test('unarchived and brand-new conversations need no restore', async () => {
    restores = 0
    await restoreArchivedForTurn(active, 'user')
    await restoreArchivedForTurn(null, 'trigger')
    expect(restores).toBe(0)
  })
})

describe('restoreArchivedSession', () => {
  test('a failed restore never fails the admitted turn', async () => {
    updateOne = () => Promise.reject(new Error('mongo down'))

    expect(await restoreArchivedSession('s1', 'user')).toBeUndefined()
  })
})
