import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useObservability } from '@/lib/test/doubles/observability'

import type { AgentDevice } from './store'

const failures: string[] = []
let unavailable = false
const collection = {
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

const { buildDeviceAccessAuditEntry, recordDeviceAccessChange } = await import('./access-audit')

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
