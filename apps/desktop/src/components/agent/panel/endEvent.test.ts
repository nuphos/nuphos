import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

import type { runEndEvent as Run } from './endEvent.ts'
import type { Tab } from './model'

let runEndEvent: typeof Run

before(async () => {
  mock.module('../../../lib/analytics.ts', {
    namedExports: { track: () => {}, trackError: () => {} },
  })
  mock.module('./endEventDecision.ts', {
    namedExports: {
      emptyEndDecision: () => ({ updaterRan: false, stopNotification: null }),
      decideEndOfStream: (
        _ctx: unknown,
        args: { decision: Record<string, unknown> },
        prev: Tab[],
      ) => {
        args.decision.updaterRan = true
        args.decision.stopNotification = { title: 'Review', body: 'All done.', sessionId: 's' }

        return prev
      },
    },
  })
  mock.module('./endEventEffects.ts', {
    namedExports: {
      runEndEventEffects: (
        ctx: { fireStopNotification: (n: unknown, s: string) => void },
        args: { decision: { stopNotification: { sessionId: string } | null } },
      ) => {
        const stopped = args.decision.stopNotification

        if (stopped) ctx.fireStopNotification(stopped, stopped.sessionId)
      },
    },
  })
  runEndEvent = (await import('./endEvent.ts')).runEndEvent
})

test('effects drained before the updater runs wait for the next drain', () => {
  const updaters: ((prev: Tab[]) => Tab[])[] = []
  const pending: (() => void)[] = []
  const fired: unknown[] = []
  const ref = <T>(current: T) => ({ current })
  const drain = () => {
    const queued = pending.splice(0)

    for (const apply of queued) apply()
  }

  runEndEvent(
    {
      // React queues the updater instead of running it eagerly.
      setTabs: (updater: unknown) => void updaters.push(updater as (prev: Tab[]) => Tab[]),
      fireStopNotification: (notification: unknown) => void fired.push(notification),
      deferEndUntilTextDrained: () => false,
      pendingEndEffectsRef: ref(pending),
      tabsRef: ref([]),
      textBuffersRef: ref(new Map()),
      turnCompleteRef: ref(new Set(['stream'])),
      turnPausedRef: ref(new Map()),
      streamOwnersRef: ref(new Map()),
      stoppedRunIdsRef: ref(new Map()),
    } as unknown as Parameters<typeof Run>[0],
    'stream',
  )

  // The previous commit's passive effects flush before this update renders.
  drain()
  assert.deepEqual(fired, [])

  for (const updater of updaters) updater([])
  drain()
  assert.deepEqual(fired, [{ title: 'Review', body: 'All done.', sessionId: 's' }])

  drain()
  assert.equal(fired.length, 1)
})
