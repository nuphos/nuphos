import assert from 'node:assert/strict'
import { test } from 'node:test'

import { boxAgentName, selectorBoxes, selectorMetrics, selectorSignIn } from './selectorBoxes.ts'

import type { AgentDevice } from '../../../api/device-types'
import type { RuntimeInstance } from '../../../types/runtime'

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

test('signed-out and disabled agents stay listed so they can be signed in', () => {
  const groups = selectorBoxes([
    agent('out', 'm5', {
      local: { ownerUserId: 'u1', deviceId: 'm5', deviceLabel: 'M5', signedIn: false },
    }),
    agent('off', 'm5', { status: 'disabled' }),
  ])

  assert.deepEqual(
    groups[0]?.agents.map((item) => item.id),
    ['out', 'off'],
  )
})

test('metrics show only a live reading from an online device', () => {
  const live = selectorMetrics(device('box'))

  assert.equal(live.cpu, 18)
  assert.equal(live.memory, 37.5)
  assert.equal(live.disk, (210 / 512) * 100)
  assert.equal(live.capacity, 'Memory 12 / 32 GB · Disk 210 / 512 GB')

  for (const sample of [
    undefined,
    device('box', { online: false }),
    device('box', { metricsStatus: 'stale' }),
    device('box', { metrics: null }),
  ]) {
    assert.deepEqual(selectorMetrics(sample), {
      cpu: null,
      memory: null,
      disk: null,
      capacity: null,
    })
  }
})

test('an invalid reading becomes unavailable instead of an impossible bar', () => {
  const metrics = selectorMetrics(
    device('box', {
      metrics: {
        sampledAt: '2026-10-22T00:00:00Z',
        cpuPercent: 140,
        memory: { used: 40 * GB, total: 32 * GB },
        disk: { used: 1, total: 0 },
      },
    }),
  )

  assert.deepEqual(metrics, { cpu: null, memory: null, disk: null, capacity: null })
})

test('sign-in: a Box manager signs in here, another computer gets instructions, Cloud needs an admin', () => {
  const box = { box: { provider: 'instabox', state: 'running' } } as const

  assert.equal(
    selectorSignIn(agent('a', 'box'), device('box', { ...box, access: 'manage' }), false),
    'login',
  )
  assert.equal(
    selectorSignIn(agent('a', 'box'), device('box', { ...box, access: 'use' }), true),
    'instructions',
  )
  assert.equal(selectorSignIn(agent('a', 'mac'), device('mac'), true), 'instructions')
  assert.equal(selectorSignIn(agent('cloud'), undefined, true), 'login')
  assert.equal(selectorSignIn(agent('cloud'), undefined, false), null)
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
