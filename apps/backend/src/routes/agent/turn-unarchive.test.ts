import { describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useTokenRevocation } from '@/lib/test/doubles/token-revocation'

import { restoreArchivedForTurn, restoreArchivedSession } from './turn-unarchive'

import type * as dbActual from '@/lib/db'

let restores = 0
let findOneAndUpdate: () => Promise<{ archivedAt: Date } | null> = () => {
  restores++

  return Promise.resolve({ archivedAt: new Date('2026-09-01T00:00:00Z') })
}

useDb({
  db: (() => ({
    collection: () => ({ findOneAndUpdate: () => findOneAndUpdate() }),
  })) as unknown as typeof dbActual.db,
})
useTokenRevocation({ releaseRestoredSessions: async () => {} })

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
    findOneAndUpdate = () => Promise.reject(new Error('mongo down'))

    expect(await restoreArchivedSession('s1', 'user')).toBeUndefined()
  })
})
