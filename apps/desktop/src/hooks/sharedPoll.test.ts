import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { pollSnapshot, refreshPoll, subscribePoll } from './sharedPoll.ts'

const settle = () => new Promise((resolve) => setImmediate(resolve))

function deferredLoads() {
  const pending: ((value: number) => void)[] = []
  let calls = 0
  const load = () => {
    calls += 1

    return new Promise<number>((resolve) => pending.push(resolve))
  }

  return { load, calls: () => calls, resolveNext: (value: number) => pending.shift()?.(value) }
}

test('every watcher of a key shares one load and one timer', async () => {
  const intervals = mock.method(
    globalThis,
    'setInterval',
    () => 1 as unknown as ReturnType<typeof setInterval>,
  )
  const cleared = mock.method(globalThis, 'clearInterval', () => {})
  const loads = deferredLoads()

  try {
    const stopA = subscribePoll('shared', loads.load, 10_000, () => {})
    const stopB = subscribePoll('shared', loads.load, 10_000, () => {})

    assert.equal(loads.calls(), 1)
    assert.equal(intervals.mock.callCount(), 1)
    loads.resolveNext(7)
    await settle()
    assert.equal(pollSnapshot<number>('shared').value, 7)
    stopA()
    assert.equal(cleared.mock.callCount(), 0)
    stopB()
    assert.equal(cleared.mock.callCount(), 1)
    refreshPoll('shared')
    assert.equal(loads.calls(), 1, 'a key nobody watches is not loaded')
  } finally {
    mock.restoreAll()
  }
})

test('refreshes asked for during a load run once after it, never in parallel', async () => {
  mock.method(globalThis, 'setInterval', () => 1 as unknown as ReturnType<typeof setInterval>)
  mock.method(globalThis, 'clearInterval', () => {})
  const loads = deferredLoads()

  try {
    const stop = subscribePoll('busy', loads.load, 10_000, () => {})

    refreshPoll('busy')
    refreshPoll('busy')
    refreshPoll('busy')
    assert.equal(loads.calls(), 1)
    loads.resolveNext(1)
    await settle()
    assert.equal(loads.calls(), 2)
    loads.resolveNext(2)
    await settle()
    assert.equal(loads.calls(), 2)
    assert.equal(pollSnapshot<number>('busy').value, 2)
    stop()
  } finally {
    mock.restoreAll()
  }
})

test('ticks are skipped while the window is hidden', async () => {
  let tick: (() => void) | undefined

  mock.method(globalThis, 'setInterval', (fn: () => void) => {
    tick = fn

    return 1 as unknown as ReturnType<typeof setInterval>
  })
  mock.method(globalThis, 'clearInterval', () => {})
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: true } })
  const loads = deferredLoads()

  try {
    const stop = subscribePoll('hidden', loads.load, 10_000, () => {})

    loads.resolveNext(1)
    await settle()
    tick?.()
    assert.equal(loads.calls(), 1)
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: false } })
    tick?.()
    assert.equal(loads.calls(), 2)
    stop()
  } finally {
    mock.restoreAll()
    Reflect.deleteProperty(globalThis, 'document')
  }
})

test('a failed load keeps the last value and says it failed', async () => {
  mock.method(globalThis, 'setInterval', () => 1 as unknown as ReturnType<typeof setInterval>)
  mock.method(globalThis, 'clearInterval', () => {})
  let fail = false
  const stop = subscribePoll(
    'flaky',
    async () => (fail ? Promise.reject(new Error('down')) : 5),
    10_000,
    () => {},
  )

  try {
    await settle()
    fail = true
    refreshPoll('flaky')
    await settle()
    assert.deepEqual(pollSnapshot<number>('flaky'), { value: 5, failed: true, settled: true })
  } finally {
    stop()
    mock.restoreAll()
  }
})
