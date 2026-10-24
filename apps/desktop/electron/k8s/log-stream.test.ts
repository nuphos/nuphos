import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mock, test } from 'node:test'

import type { WebContents } from 'electron'

const noop = () => {}

// Every reconcile pass starts with a selector lookup; count them, and fail
// them so no real log stream is ever opened.
let lookups = 0

mock.module('./client.ts', {
  namedExports: {
    getClients: () => ({}),
    withAuthRetry: () => {
      lookups++

      return Promise.reject(new Error('offline'))
    },
  },
})
mock.module('./rows-workloads.ts', { namedExports: { podMatchesSelector: () => false } })

const { startWorkloadLogStream, stopWorkloadLogStream } = await import('./log-stream.ts')
const settle = () => new Promise((resolve) => setImmediate(resolve))
const PAGE_EVENTS = ['destroyed', 'render-process-gone', 'did-start-navigation']

function page() {
  const emitter = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: noop,
  })

  return {
    emitter,
    owner: emitter as unknown as WebContents,
    listeners: () => PAGE_EVENTS.reduce((n, event) => n + emitter.listenerCount(event), 0),
  }
}

test('stopped log views leave no listener on the window', () => {
  const { owner, listeners } = page()

  for (let i = 0; i < 5; i++) {
    stopWorkloadLogStream(startWorkloadLogStream('ctx', 'Deployment', 'ns', 'web', {}, owner))
  }
  assert.equal(listeners(), 0)
})

test('a reload stops the old page’s log stream', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const { emitter, owner } = page()
  const passes = async () => {
    const before = lookups

    for (let i = 0; i < 3; i++) {
      t.mock.timers.tick(5_000)
      await settle()
    }

    return lookups - before
  }

  startWorkloadLogStream('ctx', 'Deployment', 'ns', 'web', {}, owner)
  await settle()
  assert.ok((await passes()) > 0, 'the stream reconciles while its page is open')
  emitter.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  assert.equal(await passes(), 0)
})
