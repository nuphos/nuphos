import { describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { restoreArchivedSession, shouldRestoreArchivedForTurn } from './turn-unarchive'

import type * as dbActual from '@/lib/db'

let updateOne: () => Promise<{ modifiedCount: number }> = () =>
  Promise.resolve({ modifiedCount: 1 })

useDb({
  db: (() => ({
    collection: () => ({ updateOne: () => updateOne() }),
  })) as unknown as typeof dbActual.db,
})

const archived = { sessionId: 's1', archivedAt: new Date('2026-09-01T00:00:00Z') }
const active = { sessionId: 's2' }

describe('shouldRestoreArchivedForTurn', () => {
  test('a human turn brings an archived conversation back', () => {
    expect(shouldRestoreArchivedForTurn(archived, 'user')).toBe(true)
  })

  test('headless trigger turns leave the archive alone', () => {
    expect(shouldRestoreArchivedForTurn(archived, 'trigger')).toBe(false)
  })

  test('unarchived and brand-new conversations need no restore', () => {
    expect(shouldRestoreArchivedForTurn(active, 'user')).toBe(false)
    expect(shouldRestoreArchivedForTurn(null, 'user')).toBe(false)
  })
})

describe('restoreArchivedSession', () => {
  test('a failed restore never fails the admitted turn', async () => {
    updateOne = () => Promise.reject(new Error('mongo down'))

    expect(await restoreArchivedSession('s1', 'user')).toBeUndefined()
  })
})
