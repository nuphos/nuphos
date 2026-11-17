import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useObservability } from '@/lib/test/doubles/observability'

import type { AgentDevice } from './store'

const failures: string[] = []
let unavailable = false
const finds: { filter: unknown; sort?: unknown; limit?: number }[] = []
let found: Record<string, unknown>[] = []
const collection = {
  find: (filter: unknown) => {
    const call: (typeof finds)[number] = { filter }

    finds.push(call)
    const cursor = {
      sort: (sort: unknown) => {
        call.sort = sort

        return cursor
      },
      limit: (limit: number) => {
        call.limit = limit

        return cursor
      },
      toArray: () => Promise.resolve(found.slice(0, call.limit ?? found.length)),
    }

    return cursor
  },
  insertOne: () => {
    if (unavailable) throw new Error('synthetic database outage')

    return Promise.resolve({ acknowledged: true })
  },
}

useDb({ db: () => ({ collection: () => collection }) })
useObservability({
  logError: (event) => {
    failures.push(event)
  },
})

const { buildDeviceAccessAuditEntry, listDeviceAccessAudit, recordDeviceAccessChange } =
  await import('./access-audit')
const { deviceOwner } = await import('./box-access')

const box = {
  userId: 'host',
  deviceId: 'box',
  box: { createdBy: 'creator', teamId: 'team' },
  access: [{ teamId: 'team', everyone: false, userIds: ['mate'], managerIds: ['lead'] }],
} as unknown as AgentDevice
const next = { everyone: true, userIds: [], managerIds: ['lead'] }
const authorityOf = (actorUserId: string) =>
  buildDeviceAccessAuditEntry(box, 'team', next, { actorUserId, via: 'box_access' }).actorAuthority

test('the authority recorded is what the actor held before the change', () => {
  // A Box's owner is whoever made it, not the host account it runs under.
  expect(authorityOf('creator')).toBe('owner')
  expect(authorityOf('host')).toBeNull()
  expect(authorityOf('lead')).toBe('manage')
  // Using it is not managing it: such a change is recorded as unauthorized, not hidden.
  expect(authorityOf('mate')).toBeNull()
})

test('the owner it records is always box-access’s deviceOwner', () => {
  const devices = [
    box,
    { ...box, box: { teamId: 'team' } },
    { userId: 'host', deviceId: 'mac' },
  ] as unknown as AgentDevice[]

  // The owner check is repeated here to avoid an import cycle; this keeps the two in step.
  for (const device of devices)
    for (const actorUserId of ['host', 'creator', 'lead'])
      expect(
        buildDeviceAccessAuditEntry(device, 'team', next, { actorUserId, via: 'share' })
          .actorAuthority === 'owner',
      ).toBe(deviceOwner(device) === actorUserId)
})

test('a change that follows a membership change says so, whatever the actor holds', () => {
  for (const via of ['team_leave', 'team_removal'] as const)
    expect(
      buildDeviceAccessAuditEntry(box, 'team', null, { actorUserId: 'creator', via }),
    ).toMatchObject({ actorAuthority: 'team_membership', next: null })
})

test('a first grant records no previous access', () => {
  const entry = buildDeviceAccessAuditEntry(
    { userId: 'owner', deviceId: 'mac' } as AgentDevice,
    'team',
    next,
    { actorUserId: 'owner', via: 'share' },
  )

  expect(entry).toMatchObject({ actorAuthority: 'owner', previous: null, next })
})

test('a failed write is logged and never thrown at the change it describes', async () => {
  unavailable = true
  const entry = buildDeviceAccessAuditEntry(box, 'team', next, {
    actorUserId: 'lead',
    via: 'share',
  })

  expect(await recordDeviceAccessChange(entry)).toBeUndefined()
  expect(failures).toEqual(['agent.device_access_audit.write_failed'])
  unavailable = false
})

test('listing stays on one computer in one team, within the range, after the cursor', async () => {
  const { ObjectId } = await import('mongodb')
  const ids = [new ObjectId(), new ObjectId()]
  const changedAt = new Date('2026-11-01T00:00:00Z')

  found = ids.map((_id) => ({ _id, changedAt }))
  finds.length = 0
  const scope = { ownerUserId: 'host', deviceId: 'box', teamId: 'team' }
  const page = await listDeviceAccessAudit(scope, {
    limit: 1,
    cursor: `2026-11-02T00:00:00.000Z_${ids[1]!.toHexString()}`,
    since: new Date('2026-10-01T00:00:00Z'),
    until: new Date('2026-11-03T00:00:00Z'),
  })

  expect(finds[0]).toEqual({
    filter: {
      ...scope,
      changedAt: { $gte: new Date('2026-10-01T00:00:00Z'), $lt: new Date('2026-11-03T00:00:00Z') },
      $or: [
        { changedAt: { $lt: new Date('2026-11-02T00:00:00Z') } },
        { changedAt: new Date('2026-11-02T00:00:00Z'), _id: { $lt: ids[1] } },
      ],
    },
    sort: { changedAt: -1, _id: -1 },
    limit: 2,
  })
  // One more than asked came back, so the page ends on the first with a cursor to it.
  expect(page.entries).toHaveLength(1)
  expect(page.nextCursor).toBe(`2026-11-01T00:00:00.000Z_${ids[0]!.toHexString()}`)
})
