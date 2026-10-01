import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  failureMessage,
  looksStale,
  parseInspect,
  storeVerdict,
  waitingNote,
} from './dev-store-health.ts'

import type { ContainerState } from './dev-store-health.ts'

function container(
  service: string,
  status: string,
  health: string | null,
  restarting = false,
): unknown {
  return {
    Name: `/nuphos-dev-${service}-1`,
    Config: { Labels: { 'com.docker.compose.service': service } },
    State: {
      Status: status,
      Restarting: restarting,
      ExitCode: restarting ? 1 : 0,
      ...(health ? { Health: { Status: health, Log: [{ Output: ' bucket x: HTTP 503\n' }] } } : {}),
    },
  }
}

const TIMEOUT = 120_000

function states(...entries: unknown[]): Map<string, ContainerState> {
  return parseInspect(JSON.stringify(entries))
}

test('each store is judged on its own container, not on the shared compose result', () => {
  const found = states(
    container('mongo', 'running', 'healthy'),
    container('rustfs', 'restarting', 'unhealthy', true),
  )

  assert.deepEqual(storeVerdict(found.get('mongo'), 5_000, TIMEOUT), { kind: 'ready' })
  assert.deepEqual(storeVerdict(found.get('rustfs'), 5_000, TIMEOUT), {
    kind: 'waiting',
    detail: 'restarting',
  })
  assert.equal(found.get('rustfs')?.name, 'nuphos-dev-rustfs-1')
  assert.equal(found.get('rustfs')?.healthOutput, 'bucket x: HTTP 503')
})

test('a restarting store waits, then is flagged, then recovers when it turns healthy', () => {
  const flaky = states(container('rustfs', 'running', 'starting')).get('rustfs')
  const healed = states(container('rustfs', 'running', 'healthy')).get('rustfs')

  assert.equal(storeVerdict(flaky, 30_000, TIMEOUT).kind, 'waiting')
  assert.deepEqual(storeVerdict(flaky, TIMEOUT, TIMEOUT), {
    kind: 'recovering',
    detail: 'starting',
  })
  assert.deepEqual(storeVerdict(healed, TIMEOUT + 10_000, TIMEOUT), { kind: 'ready' })
})

test('a store that is gone for good is dead right away', () => {
  assert.deepEqual(storeVerdict(undefined, 0, TIMEOUT), { kind: 'dead', detail: 'no container' })
  assert.deepEqual(
    storeVerdict(states(container('mongo', 'exited', null)).get('mongo'), 0, TIMEOUT),
    { kind: 'dead', detail: 'exited (code 0)' },
  )
  assert.equal(
    storeVerdict(states(container('mongo', 'created', null)).get('mongo'), 0, TIMEOUT).kind,
    'dead',
  )
})

test('a container without a healthcheck is ready once running', () => {
  assert.equal(
    storeVerdict(states(container('mongo', 'running', null)).get('mongo'), 0, TIMEOUT).kind,
    'ready',
  )
})

test('dev:reset is suggested only on evidence of a stale stack', () => {
  const slow = failureMessage({ kind: 'recovering', detail: 'unhealthy' }, 120, 'HTTP 503')
  const stale = failureMessage({ kind: 'dead', detail: 'exited (code 1)' }, 3, 'bucket x: HTTP 403')

  assert.equal(
    slow,
    'not healthy after 120s (unhealthy): HTTP 503 — still watching; see bun run dev:logs',
  )
  assert.match(stale, /^exited \(code 1\): bucket x: HTTP 403 — .*bun run dev:reset$/)
  assert.equal(looksStale('Container nuphos-dev-rustfs-1 is unhealthy'), false)
  assert.equal(
    looksStale('The AWS Access Key Id you provided does not exist: InvalidAccessKeyId'),
    true,
  )
})

test('downstream rows name what they are waiting for', () => {
  assert.equal(waitingNote(['mongo', 'rustfs']), 'waiting for mongo and rustfs …')
  assert.equal(waitingNote([]), null)
})
