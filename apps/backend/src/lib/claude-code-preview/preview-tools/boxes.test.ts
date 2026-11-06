import { ObjectId } from 'mongodb'
import { afterEach, beforeEach, expect, test } from 'bun:test'

import { deviceAccessDeps } from '@/lib/agent/devices/box-access'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentDevicePresence } from '@/lib/test/doubles/agent-devices-presence'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useBoxInstabox } from '@/lib/test/doubles/box-instabox'
import { useModels } from '@/lib/test/doubles/models'

import { boxToolModule } from './boxes'

import type { AgentDevice } from '@/lib/agent/devices/store'

// The agent's Box tools reach only Boxes on the team's own instabox accounts,
// and a Box an agent creates is selected for its conversation.
const teamId = '65f000000000000000000001'
const ctx = { userId: 'actor', teamId, sessionId: 'session', locale: 'en' }
const accountId = new ObjectId().toHexString()
let accounts: { id: ObjectId; label: string }[] = []
let role: 'ADMINISTRATOR' | 'MEMBER' = 'ADMINISTRATOR'
let selection: string[] | undefined
const calls: unknown[][] = []
const box = (deviceId: string, account?: string) =>
  ({
    deviceId,
    userId: 'actor',
    label: deviceId,
    box: {
      provider: 'instabox',
      teamId,
      createdBy: 'actor',
      sandboxId: `m_${deviceId}`,
      ...(account ? { accountId: account } : {}),
    },
  }) as unknown as AgentDevice
const devices = [box('team-box', accountId), box('nuphos-box')]

useModels({
  teamByosBindings: (() => ({
    findOne: () => Promise.resolve({ instaboxAccounts: accounts }),
  })) as never,
})
useAgentDb({
  agentConversations: (() => ({
    findOne: () =>
      Promise.resolve(
        selection === undefined ? null : { credentialAccess: { instaboxAccountIds: selection } },
      ),
    updateOne: (filter: unknown, update: unknown) => {
      calls.push(['select', filter, update])

      return Promise.resolve({ matchedCount: 1 })
    },
  })) as never,
})
useAgentDeviceStore({
  getAgentDevice: (_u: string, id: string) =>
    Promise.resolve(devices.find((d) => d.deviceId === id) ?? null),
  listTeamBoxes: () => Promise.resolve(devices),
})
useAgentDevicePresence({
  isDevicePresent: () => Promise.resolve(true),
  waitForPresence: () => Promise.resolve(true),
})
useBoxInstabox({
  boxState: () => Promise.resolve('running'),
  createBox: (...args: unknown[]) => {
    calls.push(['create', ...args])

    return Promise.resolve(box('new-box', accountId))
  },
  pauseBox: (_u: string, id: string) => {
    calls.push(['pause', id])

    return Promise.resolve(box(id))
  },
})

const savedDeps = { ...deviceAccessDeps }

beforeEach(() => {
  calls.length = 0
  accounts = [{ id: new ObjectId(accountId), label: 'Team account' }]
  role = 'ADMINISTRATOR'
  selection = undefined
  Object.assign(deviceAccessDeps, {
    role: () => Promise.resolve(role),
    findGranted: () => Promise.resolve([]),
    listGranted: () => Promise.resolve([]),
  })
})

afterEach(() => {
  Object.assign(deviceAccessDeps, savedDeps)
})

const handlers = () => boxToolModule(ctx, { publish: async () => {} }).handlers(ctx)

test('lists only Boxes on the team’s instabox accounts', async () => {
  const result = await handlers().list_boxes!({ label: 'List' })

  expect(result.structuredContent).toMatchObject({
    accounts: [{ id: accountId, label: 'Team account' }],
    boxes: [{ deviceId: 'team-box', instaboxAccountId: accountId, state: 'running' }],
  })
})

test('creates on the only account and selects the Box for this conversation', async () => {
  const result = await handlers().create_box!({ label: 'Create' })

  expect(result.isError).not.toBe(true)
  expect(calls).toEqual([
    ['create', 'actor', teamId, 'Agent Box', { vcpus: undefined, accountId }],
    [
      'select',
      { sessionId: 'session', teamId, credentialAccess: { $exists: true } },
      { $addToSet: { 'credentialAccess.deviceIds': 'new-box' } },
    ],
  ])
  expect(result.structuredContent).toMatchObject({
    deviceId: 'new-box',
    joined: true,
    selected: true,
  })
})

test('creating needs an administrator and a bound account', async () => {
  role = 'MEMBER'
  expect((await handlers().create_box!({ label: 'Create' })).isError).toBe(true)
  role = 'ADMINISTRATOR'
  accounts = []
  expect((await handlers().create_box!({ label: 'Create' })).isError).toBe(true)
  expect(calls).toEqual([])
})

test('a Box on the deployment’s account is out of reach', async () => {
  const refused = await handlers().update_box!({
    label: 'Stop',
    deviceId: 'nuphos-box',
    action: 'stop',
  })

  expect(refused.isError).toBe(true)
  await handlers().update_box!({ label: 'Stop', deviceId: 'team-box', action: 'stop' })
  expect(calls).toEqual([['pause', 'team-box']])
})

test('a conversation that selected instabox accounts reaches only those', async () => {
  selection = []
  expect((await handlers().list_boxes!({ label: 'List' })).structuredContent).toMatchObject({
    accounts: [],
    boxes: [],
  })
  expect((await handlers().create_box!({ label: 'Create' })).isError).toBe(true)
  expect(
    (await handlers().update_box!({ label: 'Stop', deviceId: 'team-box', action: 'stop' })).isError,
  ).toBe(true)
  selection = [accountId]
  await handlers().update_box!({ label: 'Stop', deviceId: 'team-box', action: 'stop' })
  expect(calls).toEqual([['pause', 'team-box']])
})
