import assert from 'node:assert/strict'
import test from 'node:test'

import { BOX_METRICS_POLL_MS, BOX_OFFLINE_POLL_MS, boxPollMs } from './boxPresentation.ts'
import {
  appUpdateConfirm,
  appUpdateLabel,
  BOX_RESTART_TIMEOUT_MS,
  boxRestartEnded,
  boxRestartLabel,
  boxRestartOf,
  boxRestartStep,
  boxUpdateConfirm,
} from './boxRestartPresentation.ts'
import { boxRestarts } from './boxRestartStore.ts'

import type { AgentDevice } from '../../api/device-types'

const BEFORE = '2026-10-21T07:00:00.000Z'
const AFTER = '2026-10-21T08:00:01.000Z'
const device = (online: boolean, updateStartedAt?: string, lastSeenAt = BEFORE): AgentDevice => ({
  deviceId: 'box-1',
  label: 'Build box',
  platform: 'linux',
  online,
  lastSeenAt,
  box: {
    provider: 'instabox',
    sandboxId: 'sb',
    state: 'running',
    ...(updateStartedAt ? { updateStartedAt } : {}),
  },
})
const update = { kind: 'update' as const, startedAt: 0, lastSeenAt: BEFORE }

test('an update restart ends once the host has reported in again, however fast it was', () => {
  // Still the report from before the request: the host has not restarted yet.
  assert.equal(boxRestartStep(update, device(true), 1_000).outcome, 'restarting')
  assert.equal(boxRestartStep(update, device(false), 5_000).outcome, 'restarting')
  // Back between two readings, never seen offline: back as soon as it reported again.
  assert.equal(boxRestartStep(update, device(true, undefined, AFTER), 2_000).outcome, 'back')
})

test('a host that has not reported in again is still restarting long after the request', () => {
  assert.equal(boxRestartStep(update, device(true), 120_000).outcome, 'restarting')
})

test('a resumed host is back the first time it is online', () => {
  const resume = { ...update, kind: 'resume' as const }

  assert.equal(boxRestartStep(resume, device(false), 1_000).outcome, 'restarting')
  assert.equal(boxRestartStep(resume, device(true), 1_000).outcome, 'back')
})

test('a host still away after the timeout ends the restart, and a deleted Box drops it', () => {
  assert.equal(boxRestartStep(update, device(false), BOX_RESTART_TIMEOUT_MS + 1).outcome, 'timeout')
  assert.equal(boxRestartStep(update, undefined, 1_000).outcome, 'gone')
})

test('the card and toasts name what is happening', () => {
  assert.equal(boxRestartLabel('update'), 'Updating, restarting…')
  assert.equal(boxRestartLabel('resume'), 'Resuming…')
  assert.equal(boxRestartEnded('update', 'timeout', 'Build box')?.tone, 'error')
  assert.match(boxRestartEnded('resume', 'timeout', 'Build box')?.description ?? '', /Resume/)
  assert.equal(boxRestartEnded('update', 'back', 'Build box')?.title, 'Build box is back')
  // The card returning to its agents says enough after a resume, and a deleted Box says nothing.
  assert.equal(boxRestartEnded('resume', 'back', 'Build box'), null)
  assert.equal(boxRestartEnded('update', 'gone', 'Build box'), null)
})

test('the update confirmation names the Box and promises only what the update does', () => {
  const confirm = boxUpdateConfirm('Build box', '0.4.2')

  assert.equal(confirm.title, 'Update Build box?')
  assert.match(confirm.description, /restarts Nuphos on Build box now/)
  assert.match(confirm.description, /latest version available \(expected v0\.4\.2\)/)
  assert.match(confirm.description, /computer itself keeps running/)
  assert.match(confirm.description, /even if the install fails/)
  // It does not wait for running work, and says what happens to it.
  assert.match(confirm.description, /A Task running on it stops where it is/)
  assert.match(confirm.description, /Send a message to continue a stopped Task/)
  assert.doesNotMatch(confirm.description, /\bagents?\b|runtime|does not start while/i)
  assert.doesNotMatch(boxUpdateConfirm('Build box', undefined).description, /expected/)
  assert.doesNotMatch(confirm.description, /[\u2013\u2014]/)
})

test('updating another computer says it restarts now and what happens to its Tasks', () => {
  const confirm = appUpdateConfirm('Office mini', '0.127.0')

  assert.equal(confirm.title, 'Update Office mini?')
  assert.equal(
    confirm.description,
    'This restarts Nuphos on Office mini now to install v0.127.0. A Task running on it stops where it is, and its other Tasks wait until it reconnects. Send a message to continue a stopped Task.',
  )
})

test('an update the backend reports shows for every viewer, and holds until it clears', () => {
  const at = '2026-10-21T08:00:00.000Z'

  assert.deepEqual(boxRestartOf(undefined, device(false, at)), {
    kind: 'update',
    startedAt: Date.parse(at),
  })
  assert.equal(boxRestartOf(undefined, device(false)), undefined)
  // Reported in again, but the backend still notes the update: still restarting.
  assert.equal(boxRestartStep(update, device(true, at, AFTER), 10_000).outcome, 'restarting')
  assert.equal(boxRestartStep(update, device(true, undefined, AFTER), 12_000).outcome, 'back')
})

test('the store keeps a restart until its host is back and reports how it ended', () => {
  boxRestarts.start('box-1', 'team-a', 'update', BEFORE, 0)
  assert.deepEqual(boxRestarts.settle([device(false)], 'team-a', 1_000), [])
  assert.deepEqual(boxRestarts.settle([device(true)], 'team-a', 1_500), [])
  const ended = boxRestarts.settle([device(true, undefined, AFTER)], 'team-a', 2_000)

  assert.deepEqual(
    ended.map(({ kind, outcome }) => ({ kind, outcome })),
    [{ kind: 'update', outcome: 'back' }],
  )
  assert.equal(boxRestarts.current().size, 0)
})

test("another team's list neither ends nor moves a restart", () => {
  boxRestarts.start('box-1', 'team-a', 'resume', undefined, 0)
  assert.deepEqual(boxRestarts.settle([], 'team-b', 1_000), [])
  assert.equal(boxRestarts.current().get('box-1')?.kind, 'resume')
  // Its own team's list, without the Box: it was deleted.
  assert.deepEqual(
    boxRestarts.settle([], 'team-a', 2_000).map(({ outcome }) => outcome),
    ['gone'],
  )
  assert.equal(boxRestarts.current().size, 0)
})

test('a Box updating for any viewer is polled like a live one, not left for 30 s', () => {
  assert.equal(boxPollMs([device(false, '2026-10-21T08:00:00.000Z')], false), BOX_METRICS_POLL_MS)
  assert.equal(boxPollMs([device(false)], false), BOX_OFFLINE_POLL_MS)
})

test("another computer's menu says whether its Desktop is current, downloading or ready", () => {
  assert.equal(appUpdateLabel({ version: '0.120.0' }), 'Up to date')
  assert.equal(
    appUpdateLabel({ version: '0.120.0', update: { version: '0.121.0', ready: false } }),
    'Downloading v0.121.0',
  )
  assert.equal(
    appUpdateLabel({ version: '0.120.0', update: { version: '0.121.0', ready: true } }),
    'Update to v0.121.0',
  )
})

test('a computer whose Desktop did not come back is opened there, not resumed', () => {
  assert.match(boxRestartEnded('update', 'timeout', 'Mac', true)?.description ?? '', /Open Nuphos/)
  assert.match(boxRestartEnded('update', 'timeout', 'Box')?.description ?? '', /Resume/)
})
