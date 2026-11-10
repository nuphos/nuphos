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

test('background failure preserves the acknowledged model, still takes a pick, then recovers automatically', async (t) => {
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
  assert.match(sync.getSnapshot().error!, /connect/)
  // A write is confirmed by its own answer, so a failed read never holds it back.
  await sync.select({ configId: 'model', value: 'changed' })
  assert.equal(writes, 1)
  await flush()
  assert.equal(sync.getSnapshot().data?.options[0].currentValue, 'changed')
  fail = false
  t.mock.timers.tick(60_000)
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

test('a long reply keeps a busy session healthy: no error, however long it runs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  let status: SessionConfigState = { ...busy, options: ready('started').options }
  const sync = new SessionConfigSync({
    read: async () => status,
    write: async () => ready('unused'),
  })

  t.after(sync.start())
  await flush()
  // Agent turns run for many minutes; a busy read is progress, not a failure.
  for (let i = 0; i < 180; i++) {
    t.mock.timers.tick(10_000)
    await flush()
  }
  assert.deepEqual(sync.getSnapshot().data, status)
  assert.equal(sync.getSnapshot().error, undefined)
  assert.equal('stalled' in sync.getSnapshot(), false)

  status = ready('actual')
  t.mock.timers.tick(10_000)
  await flush()
  assert.equal(sync.getSnapshot().data?.status, 'ready')
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

test('a dormant read after moving agents drops the previous agent’s options', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let response = ready('old-agent-model')
  const sync = new SessionConfigSync({ read: async () => response, write: async () => response })
  const stop = sync.start()

  t.after(stop)
  await flush()
  response = { status: 'dormant', options: [] }
  await sync.refresh()
  assert.deepEqual(sync.getSnapshot().data, response)
})

test('streaming model selection applies the latest choice once the reply is idle', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const writes: string[] = []
  const sync = new SessionConfigSync({
    read: async () => ready('old'),
    write: async (selection) => {
      writes.push(selection.value)

      return ready(selection.value)
    },
  })
  const stop = sync.start()

  t.after(stop)
  sync.setStreaming(true)
  await flush()
  await sync.select({ configId: 'model', value: 'first' })
  await sync.select({ configId: 'model', value: 'latest' })
  assert.deepEqual(writes, [])
  assert.equal(sync.getSnapshot().queued?.[0]?.value, 'latest')
  sync.setStreaming(false)
  await flush()
  assert.deepEqual(writes, ['latest'])
  assert.equal(sync.getSnapshot().queued, undefined)
})

test('streaming retains effort and model independently and applies model first', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const writes: string[] = []
  const sync = new SessionConfigSync({
    read: async () => ready('old'),
    write: async ({ configId, value }) => {
      writes.push(`${configId}:${value}`)

      return ready('new')
    },
  })
  const stop = sync.start()

  t.after(stop)
  sync.setStreaming(true)
  await flush()
  await sync.select({ configId: 'effort', value: 'low' })
  await sync.select({ configId: 'model', value: 'new' })
  await sync.select({ configId: 'effort', value: 'high' })
  assert.equal(sync.getSnapshot().queued?.length, 2)
  assert.deepEqual(writes, [])
  sync.setStreaming(false)
  await flush()
  await flush()
  assert.deepEqual(writes, ['model:new', 'effort:high'])
  assert.equal(sync.getSnapshot().queued, undefined)
})

test('a failed queued model write does not apply effort to the previous model', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const writes: string[] = []
  const sync = new SessionConfigSync({
    read: async () => ready('old'),
    write: async ({ configId }) => {
      writes.push(configId)
      throw new Error('Model rejected')
    },
  })
  const stop = sync.start()

  t.after(stop)
  sync.setStreaming(true)
  await flush()
  await sync.select({ configId: 'model', value: 'new' })
  await sync.select({ configId: 'effort', value: 'high' })
  sync.setStreaming(false)
  await flush()
  await flush()
  assert.deepEqual(writes, ['model'])
  assert.equal(sync.getSnapshot().queued, undefined)
})

for (const status of ['ready', 'dormant'] as const)
  test(`a ${status} session that listed its choices is not polled; one that listed none is`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    let reads = 0
    let response: SessionConfigState = { status, options: ready('model').options }
    const sync = new SessionConfigSync({
      read: async () => {
        reads++

        return response
      },
      write: async () => response,
    })
    const stop = sync.start()

    t.after(stop)
    await flush()
    t.mock.timers.tick(60_000)
    await flush()
    assert.equal(reads, 1)
    response = { status, options: [] }
    await sync.refresh()
    t.mock.timers.tick(10_000)
    await flush()
    assert.equal(reads, 3)
  })

test('a slow background read never marks the settings slow, and a choice made during it is written', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const slowRead = deferred<SessionConfigState>()
  let reads = 0
  let saved = 'before'
  const writes: string[] = []
  const sync = new SessionConfigSync({
    read: () => (++reads === 2 ? slowRead.promise : Promise.resolve(ready(saved))),
    write: async (selection) => {
      writes.push(selection.value)
      saved = selection.value

      return ready(saved)
    },
  })

  t.after(sync.start())
  await flush()
  void sync.refresh()
  t.mock.timers.tick(5_000)
  assert.equal(sync.getSnapshot().slow, false)
  await sync.select({ configId: 'model', value: 'after' })
  assert.deepEqual(writes, ['after'])
  slowRead.resolve(ready('before'))
  await flush()
  assert.equal(sync.getSnapshot().data?.options[0].currentValue, 'after')
})

// The main process re-encodes a backend failure under this sentinel so its code
// and message survive IPC; parseAtlasError recovers them in the renderer.
const backendRefusal = (code: string, message: string) =>
  new Error(`__ATLAS_API_ERROR__${JSON.stringify({ code, message })}`)

test('a refused change keeps the backend’s reason through the read-back, and the next pick clears it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let fail = true
  const sync = new SessionConfigSync({
    read: async () => ready('actual'),
    write: async () => {
      if (fail)
        throw backendRefusal(
          'runtime_config_unavailable',
          'The agent session could not be restored. Refresh and try again.',
        )

      return ready('high')
    },
  })

  t.after(sync.start())
  await flush()
  await sync.select({ configId: 'effort', value: 'high' })
  await flush()
  // The read-back lands on the runtime's own value without dropping the reason.
  assert.equal(sync.getSnapshot().data?.options[0].currentValue, 'actual')
  assert.equal(
    sync.getSnapshot().writeError,
    'The agent session could not be restored. Refresh and try again.',
  )
  await sync.refresh()
  assert.equal(
    sync.getSnapshot().writeError,
    'The agent session could not be restored. Refresh and try again.',
  )
  fail = false
  await sync.select({ configId: 'effort', value: 'high' })
  assert.equal(sync.getSnapshot().writeError, undefined)
  assert.equal(sync.getSnapshot().data?.options[0].currentValue, 'high')
})

test('a change that fails without a backend reason keeps the generic note', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sync = new SessionConfigSync({
    read: async () => ready('actual'),
    write: async () => {
      // A write that times out never reaches the backend: no reason to report.
      throw new Error('Error invoking remote method: The operation was aborted due to timeout')
    },
  })

  t.after(sync.start())
  await flush()
  await sync.select({ configId: 'effort', value: 'high' })
  await flush()
  assert.match(sync.getSnapshot().writeError!, /not confirmed/)
})
