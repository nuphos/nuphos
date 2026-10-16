import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
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
  machineLine,
  newBoxBlockedReason,
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

const usage = (limitVcpus: number | null, usedVcpus: number | null, boxVcpus: number | null) => ({
  limitVcpus,
  usedVcpus,
  boxVcpus,
  subscribed: limitVcpus !== null && limitVcpus > 0,
  billingUrl: 'http://billing.test',
})

test('no Box plan blocks a new Box and tells who can fix it', () => {
  assert.match(newBoxBlockedReason(usage(0, 0, 4), true) ?? '', /no Box plan/)
  assert.match(newBoxBlockedReason(usage(0, 0, 4), false) ?? '', /administrator/)
})

test('a Box that fits the plan may start; one past it is blocked', () => {
  assert.equal(newBoxBlockedReason(usage(12, 8, 4), true), null)
  assert.match(newBoxBlockedReason(usage(12, 12, 4), true) ?? '', /12 of 12 vCPU/)
})

test('unlimited or unknown usage never blocks', () => {
  assert.equal(newBoxBlockedReason(usage(null, null, null), true), null)
  assert.equal(newBoxBlockedReason(usage(12, null, 4), true), null)
  assert.equal(newBoxBlockedReason(null, true), null)
})

test('a running Box whose host is away is Host offline; until its first join the backend says creating', () => {
  assert.equal(boxState(box('a', 'running', false)), 'hostOffline')
  assert.equal(boxState(box('a', 'creating', false)), 'creating')
  assert.equal(BOX_BADGE.creating.label, 'Starting')
  assert.equal(boxState(box('a', 'running', true)), 'running')
})

test('a member who may only use a Box gets none of the controls the backend refuses', () => {
  assert.equal(canManage({ ...box('a', 'running'), access: 'use' }), false)
  assert.equal(canManage({ ...box('a', 'running'), access: 'manage' }), true)
  assert.equal(canManage(box('a', 'running')), true, 'your own machine, no access field')
})

test('a Box can always be deleted; a computer can be removed only while offline', () => {
  const computer = { deviceId: 'c1', label: 'Mac', platform: 'darwin' } as AgentDevice

  assert.equal(removal({ ...computer, online: false })?.action, 'Remove computer')
  assert.equal(removal({ ...computer, online: true }), null)
  for (const online of [true, false])
    assert.equal(
      removal({ ...computer, online, box: { provider: 'instabox' } } as AgentDevice)?.action,
      'Delete',
    )
})
