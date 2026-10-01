import assert from 'node:assert/strict'
import { test } from 'node:test'

import { backend, mongo, rustfs } from './dev-services.ts'
import { watchStores } from './dev-store-watch.ts'

import type { ContainerState } from './dev-store-health.ts'
import type { StoreProbe } from './dev-store-watch.ts'

type Snapshot = Map<string, ContainerState> | null

function state(service: string, health: string, restarting = false): ContainerState {
  return {
    service,
    name: `nuphos-dev-${service}-1`,
    status: restarting ? 'restarting' : 'running',
    health,
    restarting,
    exitCode: restarting ? 1 : 0,
    healthOutput: '',
  }
}

function probe(rounds: Snapshot[], stepMs: number, onPause = (_round: number) => {}): StoreProbe {
  let round = 0

  return {
    inspect: () => Promise.resolve(rounds[Math.min(round, rounds.length - 1)] ?? null),
    logs: () => Promise.resolve('bucket nuphos-skills: HTTP 503'),
    pause: () => {
      round++
      onPause(round)

      return Promise.resolve()
    },
    now: () => round * stepMs,
  }
}

function resetStores() {
  for (const row of [mongo, rustfs]) {
    row.status = 'starting'
    row.health = {}
  }
}

const healthyMongo = state('mongo', 'healthy')

test('a restarting rustfs is flagged alone, then recovers without a relaunch', async () => {
  resetStores()
  const flaky = new Map([
    ['mongo', healthyMongo],
    ['rustfs', state('rustfs', 'starting', true)],
  ])
  const healed = new Map([
    ['mongo', healthyMongo],
    ['rustfs', state('rustfs', 'healthy')],
  ])
  const statuses: string[] = []
  const ok = await watchStores(
    [mongo, rustfs],
    'container nuphos-dev-rustfs-1 is unhealthy',
    probe([flaky, flaky, flaky, healed], 70_000, () => {
      statuses.push(`${mongo.status}/${rustfs.status}/${backend.note ?? ''}`)
    }),
  )

  assert.equal(ok, true)
  assert.deepEqual(statuses, [
    'ready/starting/waiting for rustfs …',
    'ready/starting/waiting for rustfs …',
    'ready/crashed/waiting for rustfs …',
  ])
  assert.equal(rustfs.status, 'ready')
  assert.equal(rustfs.lastRaw, 'bucket nuphos-skills: HTTP 503')
  assert.equal(backend.note, null)
})

test('Docker that stops answering ends the wait with a visible failure', async () => {
  resetStores()
  const ok = await watchStores([mongo, rustfs], '', probe([null], 2_000))

  assert.equal(ok, false)
  assert.equal(mongo.status, 'crashed')
  assert.equal(rustfs.status, 'crashed')
  assert.equal(backend.note, 'blocked on mongo and rustfs — press r once fixed')
})

test('a store with no container ends the wait and blames only itself', async () => {
  resetStores()
  const ok = await watchStores(
    [mongo, rustfs],
    'Bind for 127.0.0.1:9000 failed: port is already allocated',
    probe([new Map([['mongo', healthyMongo]])], 2_000),
  )

  assert.equal(ok, false)
  assert.equal(mongo.status, 'ready')
  assert.equal(rustfs.status, 'crashed')
  assert.equal(rustfs.lastRaw, 'Bind for 127.0.0.1:9000 failed: port is already allocated')
  assert.equal(backend.note, 'blocked on rustfs — press r once fixed')
})
