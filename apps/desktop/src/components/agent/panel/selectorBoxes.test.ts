import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  boxAgentName,
  selectorBoxes,
  selectorMetrics,
  sharedBoxOwner,
  signInChoices,
} from './selectorBoxes.ts'

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

test('runtimes group per computer in listed order; an offline computer is one row, last', () => {
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
      agent('signed-out', 'box', { local: local('box', false) }),
      agent('ready', 'box'),
      agent('disabled', 'box', { status: 'disabled' }),
      agent('not-ready', 'box', { notReady: true }),
      agent('away', 'mac', { local: local('mac', true, false) }),
      agent('away-signed-out', 'old', { local: local('old', false, false) }),
      agent('only-signed-out', 'pc', { local: local('pc', false) }),
      agent('only-disabled', 'nas', { status: 'disabled' }),
      agent('cloud-ok'),
      agent('cloud-out'),
    ],
    [],
  )

  assert.deepEqual(
    groups.map((group) => [group.id, group.unavailable, group.agents.map((item) => item.id)]),
    [
      ['device:box', null, ['signed-out', 'ready']],
      ['device:pc', null, ['only-signed-out']],
      ['cloud', null, ['cloud-ok', 'cloud-out']],
      ['device:mac', 'Offline', ['away']],
      ['device:old', 'Offline', ['away-signed-out']],
    ],
  )

  const quotas = new Map([['cloud-out', signedOutQuota]])
  const ids = ({ listed, signIn }: ReturnType<typeof signInChoices>) => [
    listed.map((item) => item.id),
    signIn.map((item) => item.id),
  ]
  const [box, pc, cloud] = groups.map((group) => group.agents)

  // Only runnable agents are listed; the signed-out ones wait behind one sign-in entry.
  assert.deepEqual(ids(signInChoices(box ?? [])), [['ready'], ['signed-out']])
  assert.deepEqual(ids(signInChoices(pc ?? [])), [[], ['only-signed-out']])
  assert.deepEqual(ids(signInChoices(cloud ?? [], quotas)), [['cloud-ok'], ['cloud-out']])
  // The selected agent stays listed even when signed out, so its check shows.
  assert.deepEqual(ids(signInChoices(box ?? [], quotas, 'signed-out')), [
    ['signed-out', 'ready'],
    [],
  ])
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
  // Its computer on two accounts: a name a person chose stays, the provider's own name and the
  // number its computer adds to a second agent give way to the account.
  const account = { accountLabel: 'Claude Code · sam@example.com' }

  assert.equal(
    boxAgentName({
      label: 'Reviewer in Studio',
      provider: 'claude-code',
      local: { ...local, ...account, agentLabel: 'Reviewer' },
    }),
    'Reviewer',
  )
  assert.equal(
    boxAgentName({
      label: 'Claude Code 2 in Studio',
      provider: 'claude-code',
      local: { ...local, ...account, agentLabel: 'Claude Code 2' },
    }),
    'Claude Code · sam@example.com',
  )
})

test('shared-host disclosure follows use grants, without warning owners or managers', async () => {
  const { showSharedComputerDisclosure } = await import('./selectorBoxes.ts')
  const agents = [{ local: { shared: { level: 'full' } } }] as unknown as Parameters<
    typeof selectorBoxes
  >[0]

  for (const access of ['owner', 'manage', 'use'] as const) {
    assert.equal(
      showSharedComputerDisclosure({ device: device('fixture', { access }), agents }),
      access === 'use',
    )
  }
  assert.equal(showSharedComputerDisclosure({ agents }), true)
  assert.equal(showSharedComputerDisclosure({ agents: [] }), false)
})

test("a teammate's computer names its owner; the viewer's own, a cloud one and the cloud do not", () => {
  const members = [
    {
      id: 'alice',
      name: 'Alice',
      email: 'hello@hermai.ai',
      username: 'alice',
      role: 'EDITOR' as const,
      joinedAt: '2026-01-01T00:00:00Z',
    },
  ]
  const shared = device('mini', { access: 'use', ownerUserId: 'alice' })

  assert.equal(sharedBoxOwner({ device: shared }, members), 'Shared by hello@hermai.ai')
  assert.equal(sharedBoxOwner({ device: shared }, null), 'Shared by a teammate')
  assert.equal(
    sharedBoxOwner({ device: device('mbp', { access: 'owner', ownerUserId: 'u1' }) }, members),
    null,
  )
  assert.equal(
    sharedBoxOwner(
      {
        device: device('box', {
          access: 'use',
          ownerUserId: 'alice',
          box: { provider: 'instabox' } as AgentDevice['box'],
        }),
      },
      members,
    ),
    null,
  )
  assert.equal(sharedBoxOwner({}, members), null)
})
