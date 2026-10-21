import { expect, test } from 'bun:test'

import { listOwnLocalRuntimes } from './local-runtime-catalog'

import type { RegisteredAgent } from '@/lib/agent/devices/agent-registry'
import type { AgentDevice } from '@/lib/agent/devices/store'

const work = '11111111-1111-4111-8111-111111111111'
const older = '22222222-2222-4222-8222-222222222222'
const at = new Date('2026-10-20T08:00:00Z')
const box: AgentDevice = {
  userId: 'owner',
  deviceId: 'box-1',
  label: 'Build Box',
  platform: 'linux',
  allowLocalExec: false,
  agents: [
    { provider: 'claude-code', signedIn: true },
    { provider: 'claude-code', instanceId: work, signedIn: true },
    { provider: 'codex', instanceId: older, signedIn: true },
  ] as RegisteredAgent[],
  addedAgents: [{ instanceId: work, userId: 'teammate', at }],
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
}

test('an added agent says who added it and when; older and default agents say nothing', async () => {
  const listed = await listOwnLocalRuntimes('t1', 'owner', {
    access: {
      getDevice: () => Promise.resolve(box),
      listDevices: () => Promise.resolve([box]),
      listBoxes: () => Promise.resolve([]),
      role: () => Promise.resolve('EDITOR'),
    },
    isMember: () => Promise.resolve(true),
    getPresence: () => Promise.resolve(null),
  })

  expect(listed.map(({ local }) => [local.instanceId, local.addedBy])).toEqual([
    [undefined, undefined],
    [work, { userId: 'teammate', at: at.toISOString() }],
    [older, undefined],
  ])
})
