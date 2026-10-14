import { beforeEach, expect, test } from 'bun:test'

import { useRedis } from '@/lib/test/doubles/redis'

import {
  forgetRuntimeState,
  readRuntimeStates,
  rememberPushedRuntimeState,
} from './runtime-state-store'

// The conversation list reads each session's runtime status from what the
// runtime last pushed, instead of opening a runtime connection per row.
const stored = new Map<string, string>()
let redisOn = true

useRedis({
  redisEnabled: () => redisOn,
  withRedis: (op) =>
    op({
      set: async (key: string, value: string) => {
        stored.set(key, value)

        return 'OK'
      },
      del: async (key: string) => Number(stored.delete(key)),
      mget: async (keys: string[]) => keys.map((key) => stored.get(key) ?? null),
    } as never),
})

beforeEach(() => {
  stored.clear()
  redisOn = true
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

function push(sessionId: string, value: Record<string, unknown>) {
  rememberPushedRuntimeState({
    sessionId,
    update: { sessionUpdate: 'runtime_state', snapshot: value },
  })
}

test('a pushed runtime_state is what the list reads back, epoch and revision intact', async () => {
  push('sess-a', snapshot)
  await Bun.sleep(0)

  expect(await readRuntimeStates(['sess-a', undefined, 'sess-unknown'])).toEqual([
    snapshot as never,
    null,
    null,
  ])
})

test('a lost transport clears the entry, so the list stops reporting the old state', async () => {
  push('sess-a', snapshot)
  await Bun.sleep(0)
  forgetRuntimeState('sess-a')
  await Bun.sleep(0)

  expect(await readRuntimeStates(['sess-a'])).toEqual([null])
})

test('an invalid snapshot is not stored', async () => {
  push('sess-a', { state: 'idle' })
  await Bun.sleep(0)

  expect(stored.size).toBe(0)
})

test('without Redis (one self-hosted backend) the same push is kept in memory', async () => {
  redisOn = false
  push('sess-local', snapshot)

  expect(await readRuntimeStates(['sess-local'])).toEqual([snapshot as never])
  expect(stored.size).toBe(0)
  forgetRuntimeState('sess-local')
  expect(await readRuntimeStates(['sess-local'])).toEqual([null])
})
