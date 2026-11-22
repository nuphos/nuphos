import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { removeArchivedTaskTriggers } from './archive-cleanup'

describe('removeArchivedTaskTriggers', () => {
  test('cleans enabled and disabled Triggers of the target while leaving another Task and a later Trigger', async () => {
    const before = new Date('2026-01-01T00:00:00Z')
    const after = new Date('2026-01-02T00:00:00Z')
    const ids = [new ObjectId(), new ObjectId(), new ObjectId(), new ObjectId()]
    const rows = [
      { _id: ids[0]!, userId: 'owner', targetSessionId: 'task', enabled: true, createdAt: before },
      { _id: ids[1]!, userId: 'owner', targetSessionId: 'task', enabled: false, createdAt: before },
      {
        _id: ids[2]!,
        userId: 'owner',
        targetSessionId: 'control',
        enabled: true,
        createdAt: before,
      },
      {
        _id: ids[3]!,
        userId: 'owner',
        targetSessionId: 'task',
        enabled: true,
        createdAt: after,
        archiveEpoch: 1,
      },
    ]
    const removed: string[] = []
    const cleanup = {
      find: async (sessions: string[], epoch: number) =>
        rows.filter(
          (r) =>
            sessions.includes(r.targetSessionId) &&
            (r.archiveEpoch ?? 0) < epoch &&
            !removed.includes(r._id.toHexString()),
        ),
      remove: async (id: string) => {
        removed.push(id)
      },
    }

    await removeArchivedTaskTriggers(['task'], 1, cleanup)
    await removeArchivedTaskTriggers(['task'], 1, cleanup)
    expect(removed).toEqual(ids.slice(0, 2).map((id) => id.toHexString()))
  })

  test('a failed deletion is propagated so a retry can finish', async () => {
    const id = new ObjectId()
    let attempts = 0
    const cleanup = {
      find: async () => [{ _id: id, userId: 'owner' }],
      remove: async () => {
        attempts++
        if (attempts === 1) throw new Error('temporary failure')
      },
    }

    await expect(removeArchivedTaskTriggers(['task'], 1, cleanup)).rejects.toThrow(
      'temporary failure',
    )
    await removeArchivedTaskTriggers(['task'], 1, cleanup)
    expect(attempts).toBe(2)
  })
})
