import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { queryKeys } from '../../../lib/query/keys.ts'

import type { QueryClient } from '@tanstack/react-query'

mock.module('../../../api.ts', { namedExports: { api: {} } })
const { prefetchTask } = await import('./taskTranscript.ts')

/** A query cache holding `detail` as the Task's copy and `row` as its list row; counts reads. */
function cache(detail?: object, row?: object) {
  const reads = { count: 0 }
  const client = {
    getQueryData: (key: readonly unknown[]) =>
      key.at(-1) === queryKeys.agentSessions('t1').at(-1) ? (row ? [row] : undefined) : detail,
    query: () => {
      reads.count += 1

      return Promise.resolve()
    },
  } as unknown as QueryClient

  return { client, reads }
}

const row = { sessionId: 's1', messageCount: 2, transcriptUpdatedAt: 'r1' }

test('pointing at a Task with no copy reads it ahead', () => {
  const { client, reads } = cache()

  prefetchTask(client, 't1', 's1')
  assert.equal(reads.count, 1)
})

test('pointing at a Task whose copy is behind its row reads it again', () => {
  const { client, reads } = cache({ ...row, messageCount: 1 }, row)

  prefetchTask(client, 't1', 's1')
  assert.equal(reads.count, 1)
})

test('pointing at a Task whose copy has a reply in progress reads nothing', () => {
  const { client, reads } = cache({ ...row, activeRun: { streamId: 'run1' } }, row)

  prefetchTask(client, 't1', 's1')
  assert.equal(reads.count, 0)
})
