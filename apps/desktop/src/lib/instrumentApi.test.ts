import assert from 'node:assert/strict'
import test from 'node:test'

import { instrumentApi } from './instrumentApi.ts'

test('reports rejected API calls and preserves the original rejection', async () => {
  const failure = new Error('backend unavailable')
  const seen: { operation: string; error: unknown }[] = []
  const api = instrumentApi(
    {
      loadTeam: async () => {
        throw failure
      },
    },
    (operation, error) => seen.push({ operation, error }),
  )

  await assert.rejects(api.loadTeam(), (error) => error === failure)
  assert.deepEqual(seen, [{ operation: 'loadTeam', error: failure }])
})

test('reports synchronous bridge failures and rethrows them unchanged', () => {
  const failure = new Error('IPC bridge unavailable')
  const seen: { operation: string; error: unknown }[] = []
  const api = instrumentApi(
    {
      openFile: () => {
        throw failure
      },
    },
    (operation, error) => seen.push({ operation, error }),
  )

  assert.throws(api.openFile, (error) => error === failure)
  assert.deepEqual(seen, [{ operation: 'openFile', error: failure }])
})

test('does not report successful async or synchronous calls', async () => {
  const seen: unknown[] = []
  const api = instrumentApi({ asyncValue: async () => 42, syncValue: () => 'ok' }, (...args) =>
    seen.push(args),
  )

  assert.equal(await api.asyncValue(), 42)
  assert.equal(api.syncValue(), 'ok')
  assert.deepEqual(seen, [])
})

test('reports a call that settles after the stall deadline, with its duration and outcome', async () => {
  const stalls: { operation: string; elapsedMs: number; error?: unknown }[] = []
  const failure = new Error('fetch failed')
  const later = <T>(settle: () => T) =>
    new Promise<T>((resolve) => setTimeout(() => resolve(settle()), 20))
  const api = instrumentApi(
    {
      loadSlowPage: () => later(() => 'done'),
      loadSlowFailure: () => later(() => Promise.reject(failure)),
    },
    () => undefined,
    {
      stallAfterMs: 10,
      observeStall: (operation, elapsedMs, error) => stalls.push({ operation, elapsedMs, error }),
    },
  )

  assert.equal(await api.loadSlowPage(), 'done')
  await assert.rejects(api.loadSlowFailure(), failure)
  assert.deepEqual(
    stalls.map(({ operation, error }) => ({ operation, error })),
    [
      { operation: 'loadSlowPage', error: undefined },
      { operation: 'loadSlowFailure', error: failure },
    ],
  )
  assert.ok(stalls.every(({ elapsedMs }) => elapsedMs >= 10))
})

test('does not report a call that settles before the stall deadline', async () => {
  const stalls: unknown[] = []
  const api = instrumentApi({ loadFastPage: async () => 'done' }, () => assert.fail(), {
    stallAfterMs: 10,
    observeStall: (...args) => stalls.push(args),
  })

  assert.equal(await api.loadFastPage(), 'done')
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.deepEqual(stalls, [])
})
