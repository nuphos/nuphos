import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'
import type { Tab } from './model.ts'

const reads: string[] = []
let deps: unknown[] | undefined

// Mock React's scheduling only: an effect runs again when one of its dependencies changed.
mock.module('react', {
  namedExports: {
    useEffect: (effect: () => void, next: unknown[]) => {
      if (deps?.every((value, index) => Object.is(value, next[index]))) return
      deps = next
      effect()
    },
  },
})
mock.module('../../../api.ts', {
  namedExports: {
    api: {
      agentListQueue: (sessionId: string) => {
        reads.push(sessionId)

        return Promise.resolve({ messages: [], held: {} })
      },
    },
  },
})
mock.module('./queuedAutoSend.ts', {
  namedExports: {
    syncQueued: (tab: Tab, _messages: unknown, held: unknown) => ({ ...tab, queueHeld: held }),
  },
})
const { useQueueSync } = await import('./useQueueSync.ts')

const runtime = (state: RuntimeExecution['state']): RuntimeExecution => ({
  state,
  schemaVersion: 2,
})

test('a turn the server starts from the queue is read again once it ends', async () => {
  let tabs = [{ id: 't', sessionId: 's', streaming: false } as Tab]
  const setTabs = (update: (tabs: Tab[]) => Tab[]) => {
    tabs = update(tabs)
  }
  const useSync = (runtimeState: RuntimeExecution) =>
    useQueueSync({
      activeTab: { ...tabs[0], runtimeState },
      setTabs: setTabs as never,
      teamId: 'team',
    })

  // The tab's own turn has ended, but the server already runs the queued message.
  useSync(runtime('active'))
  assert.deepEqual(reads, [])
  // Refused for usage, it goes back to the queue held.
  useSync(runtime('idle'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(reads, ['s'])
  assert.deepEqual(tabs[0].queueHeld, {})
})
