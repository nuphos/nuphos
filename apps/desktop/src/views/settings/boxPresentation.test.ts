import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BOX_BADGE,
  boxActions,
  boxAgents,
  boxSetupPhase,
  boxSetupProblem,
  boxes,
  boxPollMs,
  boxState,
  machineLine,
  machines,
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
      paused: 'Paused',
      stopped: 'Offline',
      error: "Didn't start",
    },
  )
  assert.equal(BOX_BADGE.running.tone, 'online')
  assert.equal(BOX_BADGE.error.tone, 'error')
})

test('only a running Box pauses; a paused or failed one resumes; a starting one cannot be deleted', () => {
  assert.deepEqual(boxActions('running'), { pause: true, resume: false, remove: true })
  assert.deepEqual(boxActions('paused'), { pause: false, resume: true, remove: true })
  assert.deepEqual(boxActions('error'), { pause: false, resume: true, remove: true })
  assert.deepEqual(boxActions('creating'), { pause: false, resume: false, remove: false })
})

test('lists every cloud Box and each computer while its agents are connected', () => {
  const laptop: AgentDevice = { deviceId: 'mac', label: 'Mac', platform: 'darwin', online: true }
  const away: AgentDevice = { deviceId: 'old', label: 'Mac', platform: 'darwin', online: false }
  const ids = (devices: AgentDevice[]) => devices.map((device) => device.deviceId)

  assert.deepEqual(ids(boxes([laptop, box('a', 'running')])), ['a'])
  assert.deepEqual(ids(machines([laptop, away, box('a', 'paused')])), ['mac', 'a'])
  assert.equal(boxState(laptop), 'running')
  assert.equal(boxState(away), 'stopped')
  assert.equal(boxState(box('a', 'paused')), 'paused')
})

test('polls only around a sign-in, while a Box starts, or while a running Box reconnects', () => {
  assert.equal(boxPollMs([box('a', 'running')], false), 0)
  assert.equal(boxPollMs([box('a', 'paused')], false), 0)
  assert.equal(boxPollMs([box('a', 'creating')], false), 2_000)
  assert.equal(boxPollMs([box('a', 'running', false)], false), 2_000)
  assert.equal(boxPollMs([box('a', 'running')], true), 1_500)
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
