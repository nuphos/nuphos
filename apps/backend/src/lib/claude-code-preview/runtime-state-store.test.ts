import { afterAll, afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test'
import Redis from 'ioredis'

import { useRedis } from '@/lib/test/doubles/redis'

import {
  forgetRuntimeState,
  holdRuntimeState,
  readRuntimeStates,
  rememberPushedRuntimeState,
  rememberRuntimeState,
} from './runtime-state-store'

// The conversation list reads each session's runtime status from what the
// runtime last pushed, instead of opening a runtime connection per row. The
// compare-and-set script needs a real Redis; set TEST_REDIS_URL to run those
// cases (CI runs the in-memory store, which applies the same rule).
const redisUrl = process.env.TEST_REDIS_URL
const real = redisUrl ? new Redis(redisUrl) : null
let redisOn = false

useRedis({
  redisEnabled: () => redisOn,
  withRedis: (op) => (real ? op(real as never) : Promise.resolve(null)),
})

afterAll(() => real?.disconnect())

const connection = {}
const intruder = {}

beforeEach(async () => {
  redisOn = false
  await real?.flushdb()
  for (const team of ['team-a', 'team-b'])
    for (const id of ['sess-a', 'sess-b']) forgetRuntimeState(team, id)
})

const snapshot = {
  state: 'idle',
  schemaVersion: 2,
  phase: 'background_tools',
  label: 'Background tools running',
  actions: { send: true, cancel: false, steer: false },
  tools: [],
  epoch: 'runtime-1',
  revision: 7,
}

function push(from: object, sessionId: string, value: Record<string, unknown>) {
  rememberPushedRuntimeState(from, {
    sessionId,
    update: { sessionUpdate: 'runtime_state', snapshot: value },
  })
}

// Redis writes are fire-and-forget; let them land before reading.
const settle = () => Bun.sleep(real && redisOn ? 20 : 0)

function cases() {
  test('a held session’s push is what the list reads back, epoch and revision intact', async () => {
    const release = holdRuntimeState(connection, 'team-a', 'sess-a')

    push(connection, 'sess-a', snapshot)
    await settle()
    release()

    expect(await readRuntimeStates('team-a', ['sess-a', undefined, 'sess-b'])).toEqual([
      snapshot as never,
      null,
      null,
    ])
  })

  test('another connection, or a session nobody here opened, cannot store state', async () => {
    const release = holdRuntimeState(connection, 'team-a', 'sess-a')

    push(intruder, 'sess-a', snapshot)
    push(connection, 'sess-b', snapshot)
    await settle()
    release()
    push(connection, 'sess-a', snapshot)
    await settle()

    expect(await readRuntimeStates('team-a', ['sess-a', 'sess-b'])).toEqual([null, null])
  })

  test('another runtime reusing a held session id does not displace its holder', async () => {
    const release = holdRuntimeState(connection, 'team-a', 'sess-a')
    const releaseOther = holdRuntimeState(intruder, 'team-b', 'sess-a')

    push(connection, 'sess-a', snapshot)
    push(intruder, 'sess-a', { ...snapshot, state: 'active', revision: 8 })
    await settle()
    releaseOther()
    push(connection, 'sess-a', { ...snapshot, revision: 9 })
    await settle()
    release()

    expect((await readRuntimeStates('team-a', ['sess-a']))[0]?.revision).toBe(9)
    expect((await readRuntimeStates('team-b', ['sess-a']))[0]?.state).toBe('active')
  })

  test('the key is per team: another team reading the same session id sees nothing', async () => {
    rememberRuntimeState('team-a', 'sess-a', snapshot as never)
    await settle()

    expect(await readRuntimeStates('team-b', ['sess-a'])).toEqual([null])
  })

  test('an older revision of the same epoch never replaces a newer one', async () => {
    rememberRuntimeState('team-a', 'sess-a', { ...snapshot, revision: 9 } as never)
    await settle()
    rememberRuntimeState('team-a', 'sess-a', { ...snapshot, state: 'active', revision: 8 } as never)
    rememberRuntimeState('team-a', 'sess-a', { ...snapshot, state: 'active', revision: 9 } as never)
    await settle()

    expect((await readRuntimeStates('team-a', ['sess-a']))[0]?.revision).toBe(9)
    expect((await readRuntimeStates('team-a', ['sess-a']))[0]?.state).toBe('idle')

    rememberRuntimeState('team-a', 'sess-a', { ...snapshot, revision: 10 } as never)
    await settle()
    expect((await readRuntimeStates('team-a', ['sess-a']))[0]?.revision).toBe(10)
  })

  test('a new runtime epoch replaces the old one whatever its revision', async () => {
    rememberRuntimeState('team-a', 'sess-a', { ...snapshot, revision: 50 } as never)
    await settle()
    rememberRuntimeState('team-a', 'sess-a', {
      ...snapshot,
      epoch: 'runtime-2',
      revision: 1,
    } as never)
    await settle()

    expect((await readRuntimeStates('team-a', ['sess-a']))[0]?.epoch).toBe('runtime-2')
  })

  test('a lost transport clears the entry, so the list stops reporting the old state', async () => {
    rememberRuntimeState('team-a', 'sess-a', snapshot as never)
    await settle()
    forgetRuntimeState('team-a', 'sess-a')
    await settle()

    expect(await readRuntimeStates('team-a', ['sess-a'])).toEqual([null])
  })

  test('an invalid snapshot is not stored', async () => {
    const release = holdRuntimeState(connection, 'team-a', 'sess-a')

    push(connection, 'sess-a', { state: 'idle' })
    await settle()
    release()

    expect(await readRuntimeStates('team-a', ['sess-a'])).toEqual([null])
  })
}

describe('in memory (one self-hosted backend, no Redis)', () => {
  cases()

  afterEach(() => setSystemTime())

  test('an open tab probing an unchanged session keeps its entry past the TTL', async () => {
    const start = Date.now()

    rememberRuntimeState('team-a', 'sess-a', snapshot as never)
    for (let minute = 1; minute <= 25; minute++) {
      setSystemTime(start + minute * 60_000)
      rememberRuntimeState('team-a', 'sess-a', snapshot as never)
    }
    expect(await readRuntimeStates('team-a', ['sess-a'])).toEqual([snapshot as never])

    // Once nobody probes, it lapses.
    setSystemTime(start + 36 * 60_000)
    expect(await readRuntimeStates('team-a', ['sess-a'])).toEqual([null])
  })

  test('an older revision does not extend the entry', async () => {
    const start = Date.now()

    rememberRuntimeState('team-a', 'sess-a', snapshot as never)
    setSystemTime(start + 9 * 60_000)
    rememberRuntimeState('team-a', 'sess-a', { ...snapshot, revision: 6 } as never)
    setSystemTime(start + 11 * 60_000)

    expect(await readRuntimeStates('team-a', ['sess-a'])).toEqual([null])
  })
})

describe.skipIf(!real)('Redis compare-and-set', () => {
  beforeEach(() => {
    redisOn = true
  })
  cases()

  test('an open tab probing an unchanged session keeps its entry past the TTL', async () => {
    rememberRuntimeState('team-a', 'sess-a', snapshot as never)
    await settle()
    const stored = 'agent:runtime-state:team-a:sess-a'

    // Stand in for most of the TTL having passed: one second left.
    await real?.expire(stored, 1)
    rememberRuntimeState('team-a', 'sess-a', snapshot as never)
    await settle()
    await Bun.sleep(1_200)

    expect(await real?.ttl(stored)).toBeGreaterThan(590)
    expect(await readRuntimeStates('team-a', ['sess-a'])).toEqual([snapshot as never])

    // An older revision neither replaces nor extends it.
    await real?.expire(stored, 1)
    rememberRuntimeState('team-a', 'sess-a', { ...snapshot, revision: 6 } as never)
    await settle()
    await Bun.sleep(1_200)

    expect(await readRuntimeStates('team-a', ['sess-a'])).toEqual([null])
  })
})
