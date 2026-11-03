import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import type * as dbActual from '@/lib/db'

type Call = { op: string; filter: unknown }

const calls: Call[] = []
const collection = {
  deleteMany: async (filter: unknown) => {
    calls.push({ op: 'deleteMany', filter })

    return { deletedCount: 1 }
  },
}

useDb({ db: () => ({ collection: () => collection }) })

const { dropMemberShareApprovals } = await import('./local-share-store')

test('a person leaving drops the approvals they asked for or gave in that team', async () => {
  calls.length = 0
  await dropMemberShareApprovals('team', 'mate')

  expect(calls).toEqual([
    {
      op: 'deleteMany',
      filter: { teamId: 'team', $or: [{ actorId: 'mate' }, { ownerId: 'mate' }] },
    },
  ])
})
