import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mock, test } from 'node:test'

import { informers } from './k8s-watch-shared.ts'

import type { InformerEntry } from './k8s-watch-shared.ts'
import type { WebContents } from 'electron'

const noop = () => {}

mock.module('./k8s-watch-informer.ts', {
  namedExports: {
    ensureInformer: (scope: InformerEntry['scope']) => {
      const scopeKey = `${scope.context}/${scope.kind}/${scope.namespace ?? '*'}`
      let entry = informers.get(scopeKey)

      if (!entry) {
        entry = {
          scopeKey,
          scope,
          cache: new Map(),
          state: 'live',
          subscribers: new Set(),
        } as never
        informers.set(scopeKey, entry)
      }

      return Promise.resolve(entry)
    },
    scheduleTeardown: noop,
  },
})
mock.module('./k8s-watch-reconnect.ts', {
  namedExports: { restartInformer: () => Promise.resolve() },
})
mock.module('./k8s-watch-registry.ts', {
  namedExports: { REGISTRY: { Event: { needsMetrics: false } } },
})
mock.module('./k8s-metrics.ts', {
  namedExports: {
    attachMetricsSubscriber: noop,
    attachNodeMetricsSubscriber: noop,
    attachWorkloadMetricsSubscriber: noop,
    detachMetricsSubscriber: noop,
    detachNodeMetricsSubscriber: noop,
    detachWorkloadMetricsSubscriber: noop,
  },
})

const { subscribe, subscriptions, unsubscribe } = await import('./k8s-watch.ts')

function page() {
  const emitter = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: noop,
  })

  return { emitter, owner: emitter as unknown as WebContents }
}

test('a reload releases every subscription of the old page', async () => {
  const { emitter, owner } = page()

  await subscribe(owner, 'ctx', 'Event', null)
  await subscribe(owner, 'ctx', 'Event', 'ns-a')
  emitter.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })

  assert.equal(subscriptions.size, 0)
  for (const entry of informers.values()) assert.equal(entry.subscribers.size, 0)
  assert.equal(emitter.listenerCount('destroyed'), 0)
  assert.equal(emitter.listenerCount('did-start-navigation'), 0)
})

test('unsubscribing leaves no page listener behind', async () => {
  const { emitter, owner } = page()
  const { subscriptionId } = await subscribe(owner, 'ctx', 'Event', null)

  unsubscribe(subscriptionId)
  assert.equal(emitter.listenerCount('destroyed'), 0)
  assert.equal(emitter.listenerCount('did-start-navigation'), 0)
})
