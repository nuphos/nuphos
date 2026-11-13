import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { QueryClientProvider } from '@tanstack/react-query'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

const toasts: string[] = []
let tabRefresh = () => Promise.resolve()

mock.module('../components/ui/toast.ts', {
  namedExports: { toast: { apiError: (title: string) => toasts.push(title) } },
})
mock.module('../lib/frontendErrorReporter.ts', { namedExports: { reportFrontendError: () => {} } })
mock.module('../lib/query/tabQuery.ts', {
  namedExports: {
    useRefreshKey: (query: { refetch: () => Promise<unknown> }) => {
      tabRefresh = async () => {
        await query.refetch()
      }
    },
  },
})

const dom = new Window()

for (const [key, value] of Object.entries({
  window: dom,
  document: dom.document,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, key, { value, configurable: true })

const { createQueryClient } = await import('../lib/query/client.ts')
const { withResourceListCache } = await import('../lib/resourceListCache.ts')
const { useResourceList } = await import('./useResourceList.ts')

type Shown = { items: string[]; loading: boolean; error: string | null }

async function show(loaders: (() => Promise<string[]>)[], cacheKey = 'test/list') {
  const shown: Shown[][] = loaders.map(() => [])
  const List = ({ index }: { index: number }) => {
    const { items, loading, error } = useResourceList(
      withResourceListCache(cacheKey, loaders[index]),
      0,
    )

    shown[index].push({ items, loading, error })

    return null
  }
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement)
  const client = createQueryClient()

  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        loaders.map((_, index) => createElement(List, { key: index, index })),
      ),
    )
  })
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))

  return { shown, unmount: () => act(() => root.unmount()) }
}

test('views showing the same list share one read', async () => {
  dom.localStorage.clear()
  let reads = 0
  const read = async () => {
    reads += 1

    return ['a']
  }
  const { shown, unmount } = await show([read, read])

  assert.equal(reads, 1)
  assert.deepEqual(shown[1].at(-1), { items: ['a'], loading: false, error: null })
  await unmount()
})

test('rows kept on disk show at once and are refreshed behind them', async () => {
  dom.localStorage.clear()
  const stale = Date.now() - 60_000

  dom.localStorage.setItem(
    'atlas.resource-list.test/list',
    JSON.stringify({ version: 1, updatedAt: stale, items: ['old'] }),
  )
  const { shown, unmount } = await show([async () => ['new']])

  assert.deepEqual(shown[0][0], { items: ['old'], loading: false, error: null })
  assert.deepEqual(shown[0].at(-1)?.items, ['new'])
  await unmount()
})

test('a failed background read keeps the rows quietly; the tab refresh says it failed', async () => {
  dom.localStorage.clear()
  toasts.length = 0
  dom.localStorage.setItem(
    'atlas.resource-list.test/list',
    JSON.stringify({ version: 1, updatedAt: 0, items: ['old'] }),
  )
  const refusal = new Error(`__ATLAS_API_ERROR__${JSON.stringify({ message: 'No', code: 'x' })}`)
  const { shown, unmount } = await show([() => Promise.reject(refusal)])

  assert.deepEqual(shown[0].at(-1), { items: ['old'], loading: false, error: null })
  assert.deepEqual(toasts, [])
  await act(() => tabRefresh())
  assert.deepEqual(toasts, ['Could not refresh — showing cached data'])
  assert.deepEqual(shown[0].at(-1)?.items, ['old'])
  await unmount()
})

test('a first read that fails shows its error', async () => {
  dom.localStorage.clear()
  const { shown, unmount } = await show([() => Promise.reject(new Error('denied'))], 'test/none')

  // The one retry for a read that got no answer runs before the error shows.
  await act(() => new Promise((resolve) => setTimeout(resolve, 1_100)))
  assert.equal(shown[0].at(-1)?.error, 'denied')
  await unmount()
})

test('a list polls at the tick its view passes, not on a fixed interval', async () => {
  dom.localStorage.clear()
  let reads = 0
  const loader = withResourceListCache('test/polled', async () => {
    reads += 1

    return ['a']
  })
  const List = ({ pollTick }: { pollTick: number }) => {
    useResourceList(loader, 0, undefined, { pollTick })

    return null
  }
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement)
  const client = createQueryClient()
  const render = (pollTick: number) =>
    act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(List, { pollTick })))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

  await render(0)
  assert.equal(reads, 1)
  // Re-rendering on the same tick (the slow GitHub tick holds for 30 s) reads nothing.
  await render(0)
  assert.equal(reads, 1)
  await render(1)
  assert.equal(reads, 2)
  await act(() => root.unmount())
})

/** Answers the oldest read once it has started, then waits until the list has settled. */
async function answerRead(
  waiting: ((rows: string[]) => void)[],
  rows: string[],
  client: { isFetching: () => number },
) {
  await act(async () => {
    while (waiting.length === 0) await new Promise((resolve) => setTimeout(resolve, 1))
    waiting.shift()?.(rows)
    while (client.isFetching() > 0) await new Promise((resolve) => setTimeout(resolve, 1))
    await new Promise((resolve) => setTimeout(resolve, 1))
  })
}

test('a poll joins a read still in flight instead of cancelling it', async () => {
  dom.localStorage.clear()
  dom.localStorage.setItem(
    'atlas.resource-list.test/slow',
    JSON.stringify({ version: 1, updatedAt: 0, items: ['old'] }),
  )
  let reads = 0
  const waiting: ((rows: string[]) => void)[] = []
  const loader = withResourceListCache(
    'test/slow',
    () =>
      new Promise<string[]>((resolve) => {
        reads += 1
        waiting.push(resolve)
      }),
  )
  const shown: string[][] = []
  const List = ({ pollTick }: { pollTick: number }) => {
    shown.push(useResourceList(loader, 0, undefined, { pollTick }).items)

    return null
  }
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement)
  const client = createQueryClient()
  const render = (pollTick: number) =>
    act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(List, { pollTick })))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

  // The stale rows from disk are read again behind them; the read outlasts two ticks.
  await render(0)
  await render(1)
  await render(2)
  assert.equal(reads, 1)
  await answerRead(waiting, ['new'], client)
  assert.equal(reads, 1)
  assert.deepEqual(shown.at(-1), ['new'])
  await act(() => root.unmount())
})

test('a list found empty before loads again when shown, so nothing acts on the old answer', async () => {
  dom.localStorage.clear()
  let rows: string[] = []
  const waiting: ((rows: string[]) => void)[] = []
  const loader = withResourceListCache(
    'test/empty',
    () =>
      new Promise<string[]>((resolve) => {
        waiting.push(resolve)
      }),
  )
  const seen: { items: string[]; loading: boolean }[] = []
  const List = () => {
    const { items, loading } = useResourceList(loader, 0)

    seen.push({ items, loading })

    return null
  }
  const client = createQueryClient()
  const show = async () => {
    const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement)

    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(List)))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    return root
  }
  const land = () => answerRead(waiting, rows, client)

  const first = await show()

  await land()
  assert.deepEqual(seen.at(-1), { items: [], loading: false })
  await act(() => first.unmount())

  // Something was created since; the cached empty answer must not read as "not there".
  rows = ['b']
  seen.length = 0
  const second = await show()

  assert.ok(seen.every((s) => s.loading || s.items.length > 0))
  await land()
  assert.deepEqual(seen.at(-1), { items: ['b'], loading: false })
  await act(() => second.unmount())
})
