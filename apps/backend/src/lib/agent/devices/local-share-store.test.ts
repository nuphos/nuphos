import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import type * as dbActual from '@/lib/db'

type Call = { op: string; filter: unknown; update?: unknown }

const calls: Call[] = []
const collection = {
  updateOne: async (filter: unknown, update: unknown) => {
    calls.push({ op: 'updateOne', filter, update })

    return { matchedCount: 1 }
  },
  updateMany: async (filter: unknown, update: unknown) => {
    calls.push({ op: 'updateMany', filter, update })

    return { matchedCount: 1 }
  },
  deleteMany: async (filter: unknown) => {
    calls.push({ op: 'deleteMany', filter })

    return { deletedCount: 1 }
  },
}

useDb({ db: (() => ({ collection: () => collection })) as unknown as typeof dbActual.db })

const { dropMemberShareApprovals, dropOwnerTeamDeviceShares, setDeviceShare } =
  await import('./local-share-store')

test('replacing a team’s share is one update, so concurrent saves never leave two', async () => {
  calls.length = 0
  const share = { teamId: 'team', level: 'approve' as const, everyone: false, userIds: ['mate'] }

  expect(await setDeviceShare('owner', 'mac', 'team', share)).toBe(true)
  expect(calls).toHaveLength(1)
  const update = calls[0]?.update

  // A pipeline update: the other teams' shares, then this one, in a single write.
  expect(Array.isArray(update)).toBe(true)
  expect(JSON.stringify(update)).toContain('"$concatArrays"')
  expect((update as { $set: { shares: unknown } }[])[0]?.$set.shares).toEqual({
    $concatArrays: [
      {
        $filter: {
          input: { $ifNull: ['$shares', []] },
          cond: { $ne: ['$$this.teamId', 'team'] },
        },
      },
      [share],
    ],
  })
})

test('removing a share keeps only the other teams’ shares', async () => {
  calls.length = 0
  await setDeviceShare('owner', 'mac', 'team', null)
  const shares = (calls[0]?.update as { $set: { shares: { $concatArrays: unknown[] } } }[])[0]?.$set
    .shares

  expect(shares?.$concatArrays[1]).toEqual([])
})

test('a person leaving drops the approvals they asked for or gave in that team', async () => {
  calls.length = 0
  await dropMemberShareApprovals('team', 'mate')
  await dropOwnerTeamDeviceShares('team', 'owner')

  expect(calls).toEqual([
    {
      op: 'deleteMany',
      filter: { teamId: 'team', $or: [{ actorId: 'mate' }, { ownerId: 'mate' }] },
    },
    {
      op: 'updateMany',
      filter: { userId: 'owner', 'shares.teamId': 'team' },
      update: { $pull: { shares: { teamId: 'team' } } },
    },
  ])
})
