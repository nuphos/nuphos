import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  seenFrom,
  boxSessions,
  boxSizeChoices,
  accessHint,
  canShareBox,
  removal,
  BOX_BADGE,
  boxActions,
  canManage,
  boxAgents,
  boxSetupPhase,
  boxSetupProblem,
  boxes,
  boxPollMs,
  boxState,
  newAgentAction,
  agentNameTaken,
  defaultAgentName,
  machineLine,
  vanishedBoxes,
} from './boxPresentation.ts'

import type { AgentDevice } from '../../api/device-types.ts'
import type { RuntimeInstance } from '../../types/runtime.ts'

const box = (
  deviceId: string,
  state: NonNullable<AgentDevice['box']>['state'],
  online = state === 'running',
  createdAt = new Date().toISOString(),
): AgentDevice => ({
  deviceId,
  label: deviceId,
  platform: 'linux',
  online,
  createdAt,
  box: { provider: 'instabox' as const, sandboxId: `sb-${deviceId}`, state },
})

test('each Box state has a badge', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(BOX_BADGE).map(([state, view]) => [state, view.label])),
    {
      creating: 'Starting',
      connecting: 'Connecting',
      running: 'Running',
      hostOffline: 'Host offline',
      paused: 'Paused',
      stopped: 'Offline',
      error: "Didn't start",
    },
  )
  assert.equal(BOX_BADGE.running.tone, 'online')
  assert.equal(BOX_BADGE.error.tone, 'error')
})

test('only a running Box pauses; a paused or failed one resumes; a starting one cannot be deleted', () => {
  assert.deepEqual(boxActions('running'), { pause: true, resume: false })
  assert.deepEqual(boxActions('hostOffline'), { pause: true, resume: true })
  assert.deepEqual(boxActions('paused'), { pause: false, resume: true })
  assert.deepEqual(boxActions('error'), { pause: false, resume: true })
  assert.deepEqual(boxActions('creating'), { pause: false, resume: false })
})

test('a cloud Box is a Box; a computer is running while connected and stopped when not', () => {
  const laptop: AgentDevice = { deviceId: 'mac', label: 'Mac', platform: 'darwin', online: true }
  const away: AgentDevice = { deviceId: 'old', label: 'Mac', platform: 'darwin', online: false }
  const ids = (devices: AgentDevice[]) => devices.map((device) => device.deviceId)

  assert.deepEqual(ids(boxes([laptop, box('a', 'running')])), ['a'])
  assert.equal(boxState(laptop), 'running')
  assert.equal(boxState(away), 'stopped')
  assert.equal(boxState(box('a', 'paused')), 'paused')
})

test('polls fast only while a Box is made, for metrics while connected, rarely while a host is away', () => {
  assert.equal(boxPollMs([box('a', 'creating')], false), 1_000)
  assert.equal(boxPollMs([box('a', 'running')], true), 1_500)
  assert.equal(boxPollMs([box('a', 'running')], false), 5_000)
  assert.equal(boxPollMs([box('a', 'running', false)], false), 30_000)
  assert.equal(boxPollMs([box('a', 'paused')], false), 0)
  assert.equal(boxPollMs([], false), 0, 'nothing to watch: no poll at all')
})

const agent = (id: string, kind: RuntimeInstance['kind'], deviceId?: string) =>
  ({ id, kind, ...(deviceId ? { local: { deviceId } } : {}) }) as RuntimeInstance

test("a Box's agents are the team's local agents on that device", () => {
  assert.deepEqual(
    boxAgents('a', [agent('1', 'local', 'a'), agent('2', 'local', 'b'), agent('3', 'managed')]).map(
      (instance) => instance.id,
    ),
    ['1'],
  )
})

test('a new Box is starting until the team lists one of its agents', () => {
  const claude = agent('1', 'local', 'a')

  assert.equal(boxSetupPhase(null, null, []), 'idle')
  assert.equal(boxSetupPhase('a', null, []), 'starting')
  assert.equal(boxSetupPhase('a', [box('a', 'creating')], []), 'starting')
  assert.equal(boxSetupPhase('a', [box('a', 'running')], []), 'starting')
  assert.equal(boxSetupPhase('a', [box('a', 'error')], []), 'error')
  assert.equal(boxSetupPhase('a', [box('a', 'running')], [claude]), 'ready')
})

test('a new Box fails when its row disappears or it is still creating after 5 minutes', () => {
  const now = Date.parse('2026-10-15T00:10:00Z')

  assert.equal(boxSetupPhase('a', [], [], now), 'error')
  assert.equal(
    boxSetupPhase('a', [box('a', 'creating', false, '2026-10-15T00:06:00Z')], [], now),
    'starting',
  )
  assert.equal(
    boxSetupPhase('a', [box('a', 'creating', false, '2026-10-15T00:04:00Z')], [], now),
    'timeout',
  )
  assert.equal(boxSetupProblem('starting'), null)
  assert.match(boxSetupProblem('timeout') ?? '', /5 minutes/)
})

test('a creating Box that drops out of the list is reported once', () => {
  assert.deepEqual(
    vanishedBoxes([box('a', 'creating'), box('b', 'running')], []).map((device) => device.deviceId),
    ['a'],
  )
  assert.deepEqual(vanishedBoxes([box('a', 'creating')], [box('a', 'running')]), [])
})

test('a machine reads as its OS and model', () => {
  const mac: AgentDevice = { deviceId: 'm', label: 'Mac', platform: 'darwin', model: 'MacBook Pro' }

  assert.equal(machineLine(mac), 'macOS · MacBook Pro')
  assert.equal(machineLine({ ...mac, model: undefined }), 'macOS')
  assert.equal(machineLine(box('a', 'running')), 'Linux · instabox')
})

const local = (
  id: string,
  provider: RuntimeInstance['provider'],
  signedIn: boolean | null,
  agentInstances?: boolean,
) =>
  ({
    id,
    provider,
    kind: 'local',
    local: { deviceId: 'a', signedIn, agentInstances },
  }) as RuntimeInstance

test('New Agent adds an agent on a capable host, and only signs in the existing one on an older host', () => {
  const old = [local('claude', 'claude-code', true), local('codex', 'codex', null)]
  const capable = [local('claude', 'claude-code', true, true), local('codex', 'codex', null, true)]

  assert.deepEqual(newAgentAction(capable, 'codex'), { create: true })
  assert.deepEqual(newAgentAction(capable, 'claude-code'), { create: true })
  assert.deepEqual(newAgentAction(old, 'codex'), { signIn: 'codex' })
  assert.equal(newAgentAction(old, 'claude-code'), null)
})

const named = (agentLabel?: string) =>
  ({ provider: 'codex', kind: 'local', local: { agentLabel } }) as RuntimeInstance

test('a new agent is named after its provider, numbered past the names the machine has', () => {
  assert.equal(defaultAgentName([named('Claude Code')], 'codex'), 'Codex')
  assert.equal(defaultAgentName([named(), named('codex 2')], 'codex'), 'Codex 3')
  assert.equal(agentNameTaken([named('Review')], '  review '), true)
  assert.equal(agentNameTaken([named('Review')], 'Reviews'), false)
})

test('sizes are named by vCPU, not position, and say how many sessions they hold', () => {
  const small = { vcpus: 2, memMiB: 4096 }
  const medium = { vcpus: 4, memMiB: 8192 }
  const large = { vcpus: 8, memMiB: 16384 }

  assert.deepEqual(boxSizeChoices([medium, large]), [
    {
      vcpus: 4,
      tier: 1,
      name: 'Medium',
      spec: '4 vCPU · 8 GiB',
      use: 'Everyday work',
      sessions: 'Up to 3 sessions at once',
    },
    {
      vcpus: 8,
      tier: 2,
      name: 'Large',
      spec: '8 vCPU · 16 GiB',
      use: 'Heavy builds',
      sessions: 'Up to 8 sessions at once',
    },
  ])
  assert.deepEqual(
    boxSizeChoices([small, medium, large]).map((c) => [c.name, c.tier, c.sessions]),
    [
      ['Small', 0, 'Up to 1 session at once'],
      ['Medium', 1, 'Up to 3 sessions at once'],
      ['Large', 2, 'Up to 8 sessions at once'],
    ],
  )
  // The edges: 2 is still Small, 6 still Medium, 7 already Large.
  assert.deepEqual(
    boxSizeChoices([2, 3, 6, 7].map((vcpus) => ({ vcpus, memMiB: 8192 }))).map((c) => c.name),
    ['Small', 'Medium', 'Medium', 'Large'],
  )
  assert.equal(boxSessions(4096), 1)
})

test('a running Box whose host is away is Host offline; until its first join the backend says creating', () => {
  assert.equal(boxState(box('a', 'running', false)), 'hostOffline')
  assert.equal(boxState(box('a', 'creating', false)), 'creating')
  assert.equal(BOX_BADGE.creating.label, 'Starting')
  assert.equal(boxState(box('a', 'running', true)), 'running')
})

test("a Box still starting past the setup timeout didn't start: Resume is offered and the fast poll stops", () => {
  const made = Date.parse('2026-10-16T08:00:00Z')
  const stuck = box('a', 'creating', false, new Date(made).toISOString())

  assert.equal(boxState(stuck, made + 60_000), 'creating')
  assert.equal(boxState(stuck, made + 6 * 60_000), 'error')
  assert.deepEqual(boxActions('error'), { pause: false, resume: true })
  assert.equal(boxPollMs([box('b', 'creating', false, '2026-10-01T00:00:00Z')], false), 0)
})

test('a member who may only use a Box gets none of the controls the backend refuses', () => {
  assert.equal(canManage({ ...box('a', 'running'), access: 'use' }), false)
  assert.equal(canManage({ ...box('a', 'running'), access: 'manage' }), true)
  assert.equal(canManage(box('a', 'running')), true, 'your own machine, no access field')
})

test('a Box can always be deleted; a computer can be removed only while offline', () => {
  const computer = { deviceId: 'c1', label: 'Mac', platform: 'darwin' } as AgentDevice

  assert.equal(removal({ ...computer, online: false }).allowed, true)
  assert.equal(removal({ ...computer, online: false }).error, 'Could not remove computer')
  assert.equal(removal({ ...computer, online: true }).allowed, false)
  for (const online of [true, false])
    assert.equal(
      removal({ ...computer, online, box: { provider: 'instabox' } } as AgentDevice).allowed,
      true,
    )
})

test('where a machine was last seen reads as place then IP, and nothing when it never reported', () => {
  const device = { deviceId: 'c1', label: 'Mac', platform: 'darwin' } as AgentDevice

  assert.equal(seenFrom(device), null)
  assert.equal(
    seenFrom({ ...device, lastSeen: { ip: '203.0.113.7', city: 'Taipei', country: 'TW' } }),
    'Taipei, TW · 203.0.113.7',
  )
  assert.equal(seenFrom({ ...device, lastSeen: { ip: '203.0.113.7' } }), '203.0.113.7')
})

test('a Box goes Starting, then Connecting until its host joins, then Running; both time out', () => {
  const made = Date.parse('2026-10-16T08:00:00Z')
  const at = (state: 'creating' | 'connecting' | 'running', online = false) =>
    box('a', state, online, new Date(made).toISOString())

  assert.equal(BOX_BADGE.creating.label, 'Starting')
  assert.equal(BOX_BADGE.connecting.label, 'Connecting')
  assert.equal(boxState(at('creating'), made + 60_000), 'creating')
  assert.equal(boxState(at('connecting'), made + 60_000), 'connecting')
  assert.equal(boxState(at('running', true), made + 60_000), 'running')
  assert.equal(boxState(at('connecting'), made + 6 * 60_000), 'error')
  assert.equal(boxPollMs([box('b', 'connecting', false)], false), 1_000)
})

test('only a manager sees who may use a Box', () => {
  const shared = (access: { everyone: boolean; userIds: string[] }, level: 'use' | 'manage') =>
    ({
      deviceId: 'b1',
      label: 'Box',
      platform: 'linux',
      access: level,
      box: { provider: 'instabox', state: 'running', access },
    }) as AgentDevice

  assert.equal(accessHint(shared({ everyone: true, userIds: [] }, 'manage')), 'Everyone')
  assert.equal(
    accessHint(shared({ everyone: false, userIds: ['u1', 'u2'] }, 'manage')),
    'Shared with 2',
  )
  assert.equal(accessHint(shared({ everyone: false, userIds: [] }, 'manage')), 'Admins only')
  assert.equal(accessHint(shared({ everyone: true, userIds: [] }, 'use')), null)
  assert.equal(accessHint({ deviceId: 'c1', label: 'Mac', platform: 'darwin' }), null)
  // Manage access… is offered to managers of a Box only.
  assert.equal(canShareBox(shared({ everyone: true, userIds: [] }, 'manage')), true)
  assert.equal(canShareBox(shared({ everyone: true, userIds: [] }, 'use')), false)
  assert.equal(
    canShareBox({ deviceId: 'c1', label: 'Mac', platform: 'darwin', access: 'manage' }),
    false,
  )
})

test('boxSizeChoices says "1 session", not "1 sessions"', () => {
  assert.equal(boxSizeChoices([{ vcpus: 2, memMiB: 4096 }])[0]?.sessions, 'Up to 1 session at once')
})
