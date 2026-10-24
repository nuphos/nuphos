import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

const noop = () => {}

// What metrics-server reports on each poll, as rowKey → raw usage.
let polled = new Map<string, { cpu: number; memory: number }>()
const unused = () => {
  throw new Error('not used by the pod metrics poller')
}

mock.module('./k8s.ts', {
  namedExports: {
    withAuthRetry: (_context: string, fn: () => unknown) => fn(),
    getMetricsClient: () => ({ getPodMetrics: () => Promise.resolve(polled) }),
    podMetricsToUsageMap: (usage: typeof polled) => usage,
    aggregatePodCountsByNode: unused,
    aggregatePodRequestsByNode: unused,
    aggregateWorkloadResources: unused,
    getAppsApi: unused,
    getBatchApi: unused,
    getCoreApi: unused,
    nodeMetricsToUsageMap: unused,
    podMatchesSelector: unused,
  },
})

const { POLL_MS, attachMetricsSubscriber, detachMetricsSubscriber, getPodUsageFor } =
  await import('./k8s-metrics.ts')

const flush = () => new Promise((resolve) => setImmediate(resolve))

test('pod usage is kept only for pods the last poll saw, and only while subscribed', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const scopeKey = 'ctx/Pod/*'

  polled = new Map([
    ['ns/job-1', { cpu: 5, memory: 1 }],
    ['ns/web', { cpu: 7, memory: 1 }],
  ])
  attachMetricsSubscriber('ctx', scopeKey, null, noop)
  await flush()
  assert.equal(getPodUsageFor(scopeKey, 'ns/job-1')?.cpu, 5)

  // The job pod finished: the next poll no longer reports it.
  polled = new Map([['ns/web', { cpu: 9, memory: 1 }]])
  t.mock.timers.tick(POLL_MS)
  await flush()
  assert.equal(getPodUsageFor(scopeKey, 'ns/job-1'), null)
  assert.equal(getPodUsageFor(scopeKey, 'ns/web')?.cpu, 9)

  detachMetricsSubscriber(scopeKey)
  assert.equal(getPodUsageFor(scopeKey, 'ns/web'), null)
})
