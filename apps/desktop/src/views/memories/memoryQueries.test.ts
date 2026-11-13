import assert from 'node:assert/strict'
import { test } from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import { queryKeys } from '../../lib/query/keys.ts'

import { removeMemory } from './memoryQueries.ts'

const pages = (...ids: string[]) => ({
  pages: [{ memories: ids.map((id) => ({ id })), nextCursor: null, hasMore: false }],
  pageParams: [undefined],
})

test('a memory restored from Removed is read again in the cached Active list', () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  const live = queryKeys.memories('t', 'personal', 'live')
  const removed = queryKeys.memories('t', 'personal', 'removed')

  client.setQueryData(live, pages('a'))
  client.setQueryData(removed, pages('b'))
  removeMemory(client, 't', 'personal', 'removed', 'b')

  assert.deepEqual(client.getQueryData<ReturnType<typeof pages>>(removed)?.pages[0]?.memories, [])
  assert.equal(client.getQueryState(live)?.isInvalidated, true, 'Active reads again when shown')
  client.clear()
})
