import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { InfiniteQueryObserver } from '@tanstack/react-query'

import type { DeviceExecAuditEntry, DeviceExecAuditPage } from '../../api.ts'

const entry = (id: string) => ({ id }) as DeviceExecAuditEntry
let newest = 'a'
let releaseOlder = () => {}

mock.module('../../api.ts', {
  namedExports: {
    api: {
      deviceListAudit: (before?: string): Promise<DeviceExecAuditPage> => {
        if (!before) return Promise.resolve({ entries: [entry(newest)], nextCursor: 'c1' })

        return new Promise((resolve) => {
          releaseOlder = () => resolve({ entries: [entry('old')], nextCursor: null })
        })
      },
    },
  },
})
const { createQueryClient } = await import('./client.ts')
const { deviceAuditQuery } = await import('./account.ts')

test('a refresh made while older activity loads does not append that stale page', async () => {
  const client = createQueryClient()
  const observer = new InfiniteQueryObserver(client, deviceAuditQuery)
  const stop = observer.subscribe(() => {})

  try {
    await client.fetchInfiniteQuery(deviceAuditQuery)
    const more = observer.fetchNextPage()

    newest = 'b'
    const refresh = observer.refetch()

    releaseOlder()
    await Promise.all([more, refresh])
    const ids = observer
      .getCurrentResult()
      .data?.pages.flatMap((page) => page.entries.map((e) => e.id))

    assert.deepEqual(ids, ['b'])
  } finally {
    stop()
  }
})
