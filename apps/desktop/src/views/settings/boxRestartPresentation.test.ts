import assert from 'node:assert/strict'
import test from 'node:test'

import { BOX_METRICS_POLL_MS, BOX_OFFLINE_POLL_MS, boxPollMs } from './boxPresentation.ts'
import {
  BOX_RESTART_MISSED_MS,
  BOX_RESTART_TIMEOUT_MS,
  boxRestartEnded,
  boxRestartLabel,
  boxRestartOf,
  boxRestartStep,
  boxUpdateConfirm,
} from './boxRestartPresentation.ts'
import { boxRestarts } from './boxRestartStore.ts'

import type { AgentDevice } from '../../api/device-types'

const device = (online: boolean, updateStartedAt?: string): AgentDevice => ({
  deviceId: 'box-1',
  label: 'Build box',
  platform: 'linux',
  online,
  box: {
    provider: 'instabox',
    sandboxId: 'sb',
    state: 'running',
    ...(updateStartedAt ? { updateStartedAt } : {}),
  },
})
const update = { kind: 'update' as const, startedAt: 0, sawOffline: false }

test('an update restart ends only once the host has left and come back', () => {
  // Still online right after the request: the host has not stopped yet.
  assert.equal(boxRestartStep(update, device(true), 1_000).outcome, 'restarting')
  const away = boxRestartStep(update, device(false), 5_000)

  assert.equal(away.outcome, 'restarting')
  assert.equal(away.restart.sawOffline, true)
  assert.equal(boxRestartStep(away.restart, device(true), 60_000).outcome, 'back')
})

test('the host dropping before the backend reports it is still followed', () => {
  // The first reading after the request already shows the host away.
  const first = boxRestartStep(update, device(false), 500)

  assert.equal(first.outcome, 'restarting')
  assert.equal(boxRestartStep(first.restart, device(true), 2_500).outcome, 'back')
})

test('a host online throughout restarted between readings', () => {
  assert.equal(boxRestartStep(update, device(true), BOX_RESTART_MISSED_MS + 1).outcome, 'back')
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
  assert.match(confirm.description, /restarts the runtime host on Build box/)
  assert.match(confirm.description, /latest version available now \(expected v0\.4\.2\)/)
  assert.match(confirm.description, /computer itself keeps running/)
  assert.match(confirm.description, /all of its runtimes are unavailable until the host reconnects/)
  assert.match(confirm.description, /even if the install fails/)
  assert.match(confirm.description, /replying/)
  assert.doesNotMatch(boxUpdateConfirm('Build box', undefined).description, /expected/)
  assert.doesNotMatch(confirm.description, /[\u2013\u2014]/)
})

test('an update the backend reports shows for every viewer, and holds until it clears', () => {
  const at = '2026-10-21T08:00:00.000Z'

  assert.deepEqual(boxRestartOf(undefined, device(false, at)), {
    kind: 'update',
    startedAt: Date.parse(at),
    sawOffline: false,
  })
  assert.equal(boxRestartOf(undefined, device(false)), undefined)
  // Online again but the backend has not seen the host report in yet: still restarting.
  const away = { ...update, sawOffline: true }

  assert.equal(boxRestartStep(away, device(true, at), 10_000).outcome, 'restarting')
  assert.equal(boxRestartStep(away, device(true), 12_000).outcome, 'back')
})

test('the store keeps a restart until its host is back and reports how it ended', () => {
  boxRestarts.start('box-1', 'team-a', 'update', 0)
  assert.deepEqual(boxRestarts.settle([device(false)], 'team-a', 1_000), [])
  assert.equal(boxRestarts.current().get('box-1')?.sawOffline, true)
  const ended = boxRestarts.settle([device(true)], 'team-a', 2_000)

  assert.deepEqual(
    ended.map(({ kind, outcome }) => ({ kind, outcome })),
    [{ kind: 'update', outcome: 'back' }],
  )
  assert.equal(boxRestarts.current().size, 0)
})

test("another team's list neither ends nor moves a restart", () => {
  boxRestarts.start('box-1', 'team-a', 'resume', 0)
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
