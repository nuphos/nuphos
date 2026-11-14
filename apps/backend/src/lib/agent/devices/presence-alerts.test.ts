import { beforeEach, describe, expect, test } from 'bun:test'

import { OFFLINE_GRACE_MS, alertRecipients, presenceChanged } from './presence-alerts'

import type { PresenceAlertDeps } from './presence-alerts'
import type { AgentDevice } from './store'

const mac: AgentDevice = {
  userId: 'owner',
  deviceId: 'mac-1',
  label: 'MacBook Pro',
  platform: 'darwin',
  allowLocalExec: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

let online: boolean
let marked: Set<string>
let scheduled: { work: () => void; delayMs: number }[]
let sent: { userIds: string[]; online: boolean; title: string }[]

const deps: PresenceAlertDeps = {
  online: async () => online,
  getDevice: async () => mac,
  memberIds: async () => ['owner', 'ana', 'ben'],
  markOffline: async (_userId, deviceId) => !marked.has(deviceId) && Boolean(marked.add(deviceId)),
  clearOffline: async (_userId, deviceId) => marked.delete(deviceId),
  notify: (userIds, change) => {
    sent.push({ userIds, online: change.online, title: change.title })
  },
  schedule: (work, delayMs) => {
    scheduled.push({ work, delayMs })
  },
}

async function runScheduled() {
  for (const { work } of scheduled.splice(0)) work()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  online = false
  marked = new Set()
  scheduled = []
  sent = []
})

describe('presence alerts', () => {
  test('offline is announced once, after the grace period', async () => {
    await presenceChanged('owner', 'mac-1', false, deps)
    expect(scheduled[0]?.delayMs).toBe(OFFLINE_GRACE_MS)
    expect(sent).toEqual([])
    await runScheduled()
    await presenceChanged('owner', 'mac-1', false, deps)
    await runScheduled()

    expect(sent).toEqual([{ userIds: ['owner'], online: false, title: 'MacBook Pro is offline' }])
  })

  test('a computer back inside the grace period sends nothing', async () => {
    await presenceChanged('owner', 'mac-1', false, deps)
    online = true
    await presenceChanged('owner', 'mac-1', true, deps)
    await runScheduled()

    expect(sent).toEqual([])
  })

  test('back online only follows an offline alert', async () => {
    await presenceChanged('owner', 'mac-1', true, deps)
    expect(sent).toEqual([])
    await presenceChanged('owner', 'mac-1', false, deps)
    await runScheduled()
    await presenceChanged('owner', 'mac-1', true, deps)

    expect(sent.map((alert) => alert.title)).toEqual([
      'MacBook Pro is offline',
      'MacBook Pro is back online',
    ])
  })
})

describe('alert recipients', () => {
  const members = async (teamId: string) =>
    teamId === 'team-1' ? ['owner', 'ana', 'ben', 'cy'] : ['ana']

  test('the owner and the members it is shared with', async () => {
    const shared: AgentDevice = {
      ...mac,
      access: [
        { teamId: 'team-1', everyone: false, userIds: ['ana', 'gone'], managerIds: ['ben'] },
      ],
    }

    expect(await alertRecipients(shared, members)).toEqual(['owner', 'ana', 'ben'])
  })

  test('shared with everyone reaches the whole team', async () => {
    const shared: AgentDevice = {
      ...mac,
      access: [{ teamId: 'team-1', everyone: true, userIds: [], managerIds: [] }],
    }

    expect(await alertRecipients(shared, members)).toEqual(['owner', 'ana', 'ben', 'cy'])
  })

  test('a team the owner left shares nothing', async () => {
    const shared: AgentDevice = {
      ...mac,
      access: [{ teamId: 'team-2', everyone: true, userIds: [], managerIds: [] }],
    }

    expect(await alertRecipients(shared, members)).toEqual(['owner'])
  })
})
