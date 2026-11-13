import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { QueryClient, QueryObserver } from '@tanstack/react-query'

const toasts: string[] = []

mock.module('../../components/ui/toast.ts', {
  namedExports: {
    // The real toast hides a network failure unless it carries a fallback, so only count those.
    toast: {
      apiError: (title: string, _e: unknown, opts?: { fallback?: string }) => {
        if (opts?.fallback) toasts.push(title)
      },
    },
  },
})
mock.module('../../i18n/index.ts', { namedExports: { t: (text: string) => text } })

const { refreshAfterWrite } = await import('./refreshAfterWrite.ts')

const queryKey = ['team', 't', 'cloudflare', 'a', 'kv']

function watch(client: QueryClient, read: () => Promise<string[]>) {
  const observer = new QueryObserver(client, { queryKey, queryFn: read, retry: false })
  const stop = observer.subscribe(() => {})

  return { observer, stop }
}

// #2322: a failed read after a write used to leave the old rows on screen with no sign of it.
test('a failed read after a write keeps the rows and says so', async () => {
  toasts.length = 0
  const client = new QueryClient()
  let fail = false
  const { observer, stop } = watch(client, async () => {
    if (fail) throw new Error('offline')

    return ['before']
  })

  await observer.refetch()
  fail = true
  await refreshAfterWrite(client, { queryKey })

  assert.deepEqual(client.getQueryData(queryKey), ['before'])
  assert.deepEqual(toasts, ['Could not refresh — showing cached data'])
  stop()
})

// #2319: a write made while the first read was in flight used to reuse that read.
test('a read in flight before the write is dropped, not reused', async () => {
  toasts.length = 0
  const client = new QueryClient()
  let calls = 0
  let release: () => void = () => {}
  const { stop } = watch(client, () => {
    calls += 1
    if (calls === 1) {
      return new Promise((resolve) => {
        release = () => resolve(['before'])
      })
    }

    return Promise.resolve(['after'])
  })

  await refreshAfterWrite(client, { queryKey })
  release()

  assert.equal(calls, 2)
  assert.deepEqual(client.getQueryData(queryKey), ['after'])
  assert.deepEqual(toasts, [])
  stop()
})
