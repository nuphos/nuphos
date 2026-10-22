import assert from 'node:assert/strict'
import { test } from 'node:test'

import { boxAgentName, selectorBoxes, selectorMetrics } from './selectorBoxes.ts'

import type { AgentDevice } from '../../../api/device-types'
import type { RuntimeInstance, RuntimeQuota } from '../../../types/runtime'

const GB = 1024 ** 3

function agent(
  id: string,
  deviceId?: string,
  extra: Partial<RuntimeInstance> = {},
): RuntimeInstance {
  return {
    id,
    provider: 'claude-code',
    label: id,
    status: 'active',
    kind: deviceId ? 'local' : 'managed',
    createdAt: '2026-10-22T00:00:00Z',
    ...(deviceId && {
      local: { ownerUserId: 'u1', deviceId, deviceLabel: `${deviceId} label`, signedIn: true },
    }),
    ...extra,
  } as RuntimeInstance
}

function device(deviceId: string, extra: Partial<AgentDevice> = {}): AgentDevice {
  return {
    deviceId,
    label: `${deviceId} device`,
    platform: 'linux',
    online: true,
    metricsStatus: 'live',
    metrics: {
      sampledAt: '2026-10-22T00:00:00Z',
      cpuPercent: 18,
      memory: { used: 12 * GB, total: 32 * GB },
      disk: { used: 210 * GB, total: 512 * GB },
    },
    ...extra,
  }
}

test('agents group by device id in first-seen order; Cloud agents share one group', () => {
  const groups = selectorBoxes(
    [agent('a', 'm5'), agent('cloud-1'), agent('b', 'box'), agent('c', 'm5'), agent('cloud-2')],
    [device('box', { box: { provider: 'instabox', state: 'running' } })],
  )

  assert.deepEqual(
    groups.map((group) => [group.id, group.label, group.agents.map((item) => item.id)]),
    [
      ['device:m5', 'm5 label', ['a', 'c']],
      ['cloud', 'Cloud', ['cloud-1', 'cloud-2']],
      ['device:box', 'box device', ['b']],
    ],
  )
})

test('only runtimes that can run now are listed; a computer left with none is dropped', () => {
  const local = (deviceId: string, signedIn: boolean, online = true) => ({
    ownerUserId: 'u1',
    deviceId,
    deviceLabel: deviceId,
    signedIn,
    online,
  })
  const signedOutQuota: RuntimeQuota = {
    runtimeId: 'cloud-out',
    available: false,
    reason: 'Sign in required',
    windows: [],
  } as RuntimeQuota
  const groups = selectorBoxes(
    [
      agent('ready', 'box'),
      agent('signed-out', 'box', { local: local('box', false) }),
      agent('disabled', 'box', { status: 'disabled' }),
      agent('not-ready', 'box', { notReady: true }),
      agent('away', 'mac', { local: local('mac', true, false) }),
      agent('only-signed-out', 'pc', { local: local('pc', false) }),
      agent('cloud-ok'),
      agent('cloud-out'),
    ],
    [],
    new Map([['cloud-out', signedOutQuota]]),
  )

  assert.deepEqual(
    groups.map((group) => [group.id, group.agents.map((item) => item.id)]),
    [
      ['device:box', ['ready']],
      ['cloud', ['cloud-ok']],
    ],
  )
})

test('metrics are a live, sane reading or nothing', () => {
  const live = selectorMetrics(device('box'))

  assert.equal(live?.cpu, 18)
  assert.equal(live?.memory, 37.5)
  assert.equal(live?.disk, (210 / 512) * 100)
  assert.equal(live?.capacity, 'Memory 12 / 32 GB · Disk 210 / 512 GB')

  for (const sample of [
    undefined,
    device('box', { metricsStatus: 'unsupported' }),
    device('box', { metricsStatus: 'stale' }),
    device('box', { metrics: null }),
    device('box', {
      metrics: {
        sampledAt: '2026-10-22T00:00:00Z',
        cpuPercent: 140,
        memory: { used: 1, total: 2 },
        disk: { used: 1, total: 2 },
      },
    }),
    device('box', {
      metrics: {
        sampledAt: '2026-10-22T00:00:00Z',
        cpuPercent: 10,
        memory: { used: 40 * GB, total: 32 * GB },
        disk: { used: 1, total: 0 },
      },
    }),
  ]) {
    assert.equal(selectorMetrics(sample), null)
  }
})

test('inside its computer a runtime shows its own name, or its provider', () => {
  const local = { ownerUserId: 'u1', deviceId: 'mac', deviceLabel: 'Studio', signedIn: true }

  assert.equal(
    boxAgentName({
      label: 'Yuanlin (20x) in Studio',
      provider: 'claude-code',
      local: { ...local, agentLabel: 'Yuanlin (20x)' },
    }),
    'Yuanlin (20x)',
  )
  assert.equal(boxAgentName({ label: 'Codex in Studio', provider: 'codex', local }), 'Codex')
  assert.equal(boxAgentName({ label: 'Team Claude', provider: 'claude-code' }), 'Team Claude')
})
