import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

type Row = Record<string, unknown>
type Scope = { ownerId: string; deviceId: string }

/** What each share collection holds, by collection name. */
const tables: Record<string, Row[]> = {
  agent_device_share_approvals: [],
  agent_device_share_trusts: [],
}
/** The computers that are still registered. */
let devices: { userId: string; deviceId: string }[] = []

/** The scopes a `$group` over the fields it names would produce, so a wrong
 *  field path yields undefined ids and matches nothing. */
function scopesFrom(rows: Row[], pipeline: unknown[]): Scope[] {
  const id = (pipeline[0] as { $group: { _id: Record<string, string> } }).$group._id
  const seen = new Map<string, Scope>()

  for (const row of rows) {
    const scope = {
      ownerId: String(row[id.ownerId?.slice(1) ?? '']),
      deviceId: String(row[id.deviceId?.slice(1) ?? '']),
    }

    seen.set(`${scope.ownerId}/${scope.deviceId}`, scope)
  }

  return [...seen.values()]
}

const matches = (row: Row, filter: Row) =>
  Object.entries(filter).every(([field, value]) => row[field] === value)

function shareCollection(name: string) {
  tables[name] ??= []
  const rows = tables[name]

  return {
    aggregate: (pipeline: unknown[]) => ({
      toArray: async () => scopesFrom(rows, pipeline).map((scope) => ({ _id: scope })),
    }),
    deleteMany: async (filter: Row) => {
      const kept = rows.filter((row) => !matches(row, filter))
      const deletedCount = rows.length - kept.length

      rows.length = 0
      rows.push(...kept)

      return { deletedCount }
    },
  }
}

function deviceCollection() {
  return {
    find: (filter: { $or: { userId: string; deviceId: string }[] }) => ({
      toArray: async () =>
        devices.filter((device) =>
          filter.$or.some(
            (clause) => clause.userId === device.userId && clause.deviceId === device.deviceId,
          ),
        ),
    }),
  }
}

useDb({
  db: () => ({
    collection: (name: string) =>
      name === 'agent_devices' ? deviceCollection() : shareCollection(name),
  }),
})

const { dropOrphanedShareState } = await import('./local-share-orphans')

function seat() {
  tables.agent_device_share_approvals = [
    { ownerId: 'alice', deviceId: 'gone', teamId: 'team-1', actorId: 'bob' },
    { ownerId: 'alice', deviceId: 'gone', teamId: 'team-2', actorId: 'bob' },
    { ownerId: 'alice', deviceId: 'here', teamId: 'team-1', actorId: 'bob' },
    { ownerId: 'bob', deviceId: 'gone', teamId: 'team-1', actorId: 'alice' },
  ]
  tables.agent_device_share_trusts = [
    { ownerId: 'alice', deviceId: 'gone', teamId: 'team-1', actorId: 'bob' },
    { ownerId: 'alice', deviceId: 'here', teamId: 'team-1', actorId: 'bob' },
  ]
  devices = [
    { userId: 'alice', deviceId: 'here' },
    // Another person's computer under the same id is a different computer.
    { userId: 'bob', deviceId: 'gone' },
  ]
}

test('a computer that is gone leaves no answers or trusts; a registered one keeps its own', async () => {
  seat()

  expect(await dropOrphanedShareState()).toBe(1)
  expect(tables.agent_device_share_approvals).toEqual([
    { ownerId: 'alice', deviceId: 'here', teamId: 'team-1', actorId: 'bob' },
    // Bob's computer under the same id is a different computer, and is still here.
    { ownerId: 'bob', deviceId: 'gone', teamId: 'team-1', actorId: 'alice' },
  ])
  expect(tables.agent_device_share_trusts).toEqual([
    { ownerId: 'alice', deviceId: 'here', teamId: 'team-1', actorId: 'bob' },
  ])
})

test('running it again with nothing orphaned leaves every row alone', async () => {
  seat()
  await dropOrphanedShareState()

  expect(await dropOrphanedShareState()).toBe(0)
  expect(tables.agent_device_share_approvals).toHaveLength(2)
  expect(tables.agent_device_share_trusts).toHaveLength(1)
})
