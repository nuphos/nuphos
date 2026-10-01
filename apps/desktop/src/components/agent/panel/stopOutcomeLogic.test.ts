import assert from 'node:assert/strict'
import { test } from 'node:test'

import { settleStopOutcome, STOP_CONFIRM_RETRY_DELAYS_MS } from './stopOutcomeLogic.ts'

const args = { sessionId: 'session-1', streamId: 'stream-1', teamId: 'team-1' }

function dependencies(options: {
  status: 'local' | 'forwarded' | 'not_found' | 'unauthenticated' | 'failed'
  activeStreamIds?: (string | null)[]
}) {
  const waits: number[] = []
  let probes = 0

  return {
    waits,
    probes: () => probes,
    deps: {
      abort: async () => ({ status: options.status }),
      getActiveStreamId: async () => {
        const value = options.activeStreamIds?.[probes] ?? null

        probes += 1

        return value
      },
      wait: async (delayMs: number) => {
        waits.push(delayMs)
      },
    },
  }
}

test('a local cancellation waits for the runtime-backed run to disappear', async () => {
  const state = dependencies({ status: 'local', activeStreamIds: ['stream-1', null] })

  assert.deepEqual(await settleStopOutcome(args, state.deps), {
    kind: 'stopped',
    status: 'local',
  })
  assert.equal(state.probes(), 2)
  assert.deepEqual(state.waits, STOP_CONFIRM_RETRY_DELAYS_MS.slice(0, 2))
})

test('not_found is an idempotent success once the session is idle', async () => {
  const state = dependencies({ status: 'not_found', activeStreamIds: [null] })

  assert.deepEqual(await settleStopOutcome(args, state.deps), {
    kind: 'stopped',
    status: 'not_found',
  })
  assert.equal(state.probes(), 1)
})

test('a forwarded stop waits across the owner heartbeat before succeeding', async () => {
  const state = dependencies({
    status: 'forwarded',
    activeStreamIds: ['stream-1', null],
  })

  assert.deepEqual(await settleStopOutcome(args, state.deps), {
    kind: 'stopped',
    status: 'forwarded',
  })
  assert.deepEqual(state.waits, STOP_CONFIRM_RETRY_DELAYS_MS.slice(0, 2))
})

test('an accepted stop is reported only when the same stream survives every probe', async () => {
  const state = dependencies({
    status: 'forwarded',
    activeStreamIds: ['stream-1', 'stream-1', 'stream-1'],
  })

  assert.deepEqual(await settleStopOutcome(args, state.deps), {
    kind: 'still_running',
    status: 'forwarded',
  })
  assert.deepEqual(state.waits, STOP_CONFIRM_RETRY_DELAYS_MS)
})

test('a transport failure remains a real stop failure', async () => {
  const state = dependencies({ status: 'failed' })

  assert.deepEqual(await settleStopOutcome(args, state.deps), {
    kind: 'failed',
    status: 'failed',
  })
  assert.equal(state.probes(), 0)
})

test('a failed confirmation probe does not turn an accepted stop into an error', async () => {
  const waits: number[] = []
  const outcome = await settleStopOutcome(args, {
    abort: async () => ({ status: 'forwarded' }),
    getActiveStreamId: async () => {
      throw new Error('metadata unavailable')
    },
    wait: async (delayMs) => {
      waits.push(delayMs)
    },
  })

  assert.deepEqual(outcome, { kind: 'stopped', status: 'forwarded' })
  assert.deepEqual(waits, [STOP_CONFIRM_RETRY_DELAYS_MS[0]])
})
