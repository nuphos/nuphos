import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SessionConfigSync } from './sessionConfigSync.ts'

import type { SessionConfigState } from '../../../api/session-config-types.ts'

const ready = (value: string): SessionConfigState => ({
  status: 'ready',
  options: [
    {
      id: 'model',
      name: 'Model',
      kind: 'model',
      currentValue: value,
      options: [{ value, name: value }],
    },
  ],
})
const busy: SessionConfigState = { status: 'busy', options: [] }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })

  return { promise, resolve, reject }
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

test('menu/focus refreshes join the same pending read; timeout exits loading and late results stay fenced', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const first = deferred<SessionConfigState>()
  let calls = 0
  const sync = new SessionConfigSync({
    read: () => {
      calls++

      return calls === 1 ? first.promise : Promise.resolve(ready('fresh'))
    },
    write: async () => ready('unused'),
  })
  const stop = sync.start()

  t.after(stop)
  void sync.refresh()
  void sync.refresh()
  assert.equal(calls, 1)
  t.mock.timers.tick(2_000)
  assert.equal(sync.getSnapshot().slow, true)
  t.mock.timers.tick(13_000)
  await flush()
  assert.equal(sync.getSnapshot().loading, false)
  assert.match(sync.getSnapshot().error!, /connect/)
  await sync.refresh()
  assert.equal(sync.getSnapshot().data?.options[0].currentValue, 'fresh')
  first.resolve(ready('late'))
  await flush()
  assert.equal(sync.getSnapshot().data?.options[0].currentValue, 'fresh')
})

test('background failure preserves the acknowledged model, blocks writes, then recovers automatically', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let fail = false
  let writes = 0
  const sync = new SessionConfigSync({
    read: async () => {
      if (fail) throw new Error('offline')

      return ready('actual')
    },
    write: async () => {
      writes++

      return ready('changed')
    },
  })

  t.after(sync.start())
  await flush()
  fail = true
  const reading = sync.refresh()

  assert.equal(sync.getSnapshot().loading, false)
  assert.equal(sync.getSnapshot().data?.options[0].currentValue, 'actual')
  await reading
  await sync.select({ configId: 'model', value: 'changed' })
  assert.equal(writes, 0)
  assert.equal(sync.getSnapshot().data?.options[0].currentValue, 'actual')
  fail = false
  t.mock.timers.tick(20_000)
  await flush()
  assert.equal(sync.getSnapshot().error, undefined)
})

test('late reads cannot overwrite a write acknowledgement or a replacement session', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const stale = deferred<SessionConfigState>()
  let reads = 0
  const sync = new SessionConfigSync({
    read: () => {
      reads++

      return reads === 2 ? stale.promise : Promise.resolve(ready(reads > 2 ? 'selected' : 'before'))
    },
    write: async () => ready('selected'),
  })
  const stop = sync.start()

  await flush()
  void sync.refresh()
  await sync.select({ configId: 'model', value: 'selected' })
  await flush()
  stale.resolve(ready('stale'))
  await flush()
  assert.equal(sync.getSnapshot().data?.options[0].currentValue, 'selected')
  stop()
  const snapshot = sync.getSnapshot()

  t.mock.timers.tick(60_000)
  await flush()
  assert.equal(sync.getSnapshot(), snapshot)
})

test('a session stuck reporting busy is flagged stalled, and clears once it recovers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  let status: SessionConfigState = busy
  const sync = new SessionConfigSync({
    read: async () => status,
    write: async () => ready('unused'),
  })

  t.after(sync.start())
  await flush()
  assert.equal(sync.getSnapshot().data?.status, 'busy')
  assert.equal(sync.getSnapshot().stalled, false)

  // Still busy well past the stall threshold, across several poll cycles.
  t.mock.timers.tick(50_000)
  await flush()
  assert.equal(sync.getSnapshot().stalled, true)

  // The reply lands: busy clears, and so does the stalled flag.
  status = ready('actual')
  t.mock.timers.tick(10_000)
  await flush()
  assert.equal(sync.getSnapshot().data?.status, 'ready')
  assert.equal(sync.getSnapshot().stalled, false)
})

test('lost write acknowledgement is never an optimistic model and triggers readback', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const write = deferred<SessionConfigState>()
  let reads = 0
  const sync = new SessionConfigSync({
    read: async () => {
      reads++

      return ready('actual')
    },
    write: () => write.promise,
  })

  t.after(sync.start())
  await flush()
  const selecting = sync.select({ configId: 'model', value: 'unconfirmed' })

  t.mock.timers.tick(40_000)
  await selecting
  await flush()
  assert.equal(sync.getSnapshot().saving, false)
  assert.equal(reads, 2)
  assert.equal(sync.getSnapshot().data?.options[0].currentValue, 'actual')
  write.resolve(ready('late'))
  await flush()
  assert.equal(sync.getSnapshot().data?.options[0].currentValue, 'actual')
})
