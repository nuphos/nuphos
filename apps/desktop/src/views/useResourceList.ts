import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { toast } from '../components/ui/toast.ts'
import { useSilentTick } from '../hooks/useSilentRefresh.ts'
import { t } from '../i18n/index.ts'
import { reportFrontendError } from '../lib/frontendErrorReporter.ts'
import { queryKeys } from '../lib/query/keys.ts'
import { useRefreshKey } from '../lib/query/tabQuery.ts'
import { readCachedResourceList } from '../lib/resourceListCache.ts'

import type { ResourceListLoader } from '../lib/resourceListCache.ts'
import type { SetStateAction } from 'react'

const NO_ITEMS: never[] = []

/**
 * A provider's resource list for one workspace tab. Lists with a `cacheKey` are shared by every
 * view showing them and seeded from the copy kept on disk. `pollTick` asks for the tab's polling.
 */
export function useResourceList<T>(
  loader: ResourceListLoader<T>,
  refreshKey: number,
  onLoading?: (loading: boolean) => void,
  options: { enabled?: boolean; pollTick?: number } = {},
) {
  const cacheKey = loader.cacheKey
  const enabled = options.enabled ?? true
  const ownKey = useId()
  const listKey = cacheKey ?? `unsaved:${ownKey}`
  const queryKey = queryKeys.resourceList(listKey)
  const client = useQueryClient()
  const loaderRef = useRef(loader)

  useEffect(() => {
    loaderRef.current = loader
  })

  const query = useQuery({
    queryKey,
    queryFn: () => loaderRef.current(),
    enabled,
    // Rows kept on disk show at once and refresh behind them. An empty copy waits for the read,
    // so "No items" never flashes before the list is known to be empty.
    initialData: () => {
      const cached = readCachedResourceList<T>(cacheKey)

      return cached?.items.length ? cached.items : undefined
    },
    initialDataUpdatedAt: () => readCachedResourceList(cacheKey)?.updatedAt,
    refetchOnMount: (entry) => (entry.state.data?.length ? true : 'always'),
  })
  const items: T[] = query.data ?? NO_ITEMS
  // The read the view found cached when it started showing this list. An empty list from then is
  // not known to still be empty, so it loads until a newer read lands, as a cold load does.
  const [shownFrom, setShownFrom] = useState({ listKey, readAt: query.dataUpdatedAt })

  if (shownFrom.listKey !== listKey) setShownFrom({ listKey, readAt: query.dataUpdatedAt })
  const loading =
    enabled &&
    (query.isPending ||
      (items.length === 0 && query.isFetching && query.dataUpdatedAt <= shownFrom.readAt))
  const failure = query.error
  // A message set by the view holds until the next read lands.
  const stamp = query.dataUpdatedAt + query.errorUpdatedAt
  const stampRef = useRef(stamp)
  const [override, setOverride] = useState<{ stamp: number; error: string | null }>()
  // Rows already shown stay on screen when a read fails; only an empty list shows the error.
  const shownError = failure && items.length === 0 ? failure.message : null
  // Stable like the state setters they replace, since views list them in their hooks' deps.
  const setItems = useCallback(
    (next: SetStateAction<T[]>) =>
      client.setQueryData<T[]>(queryKeys.resourceList(listKey), (previous) =>
        typeof next === 'function' ? next(previous ?? []) : next,
      ),
    [client, listKey],
  )
  const setError = useCallback(
    (error: string | null) => setOverride({ stamp: stampRef.current, error }),
    [],
  )

  useEffect(() => {
    stampRef.current = stamp
  })
  // A poll that fails stays quiet; only the tab's refresh says it could not refresh.
  const refresh = async () => {
    if (!enabled) return
    const result = await query.refetch()

    if (result.isError && result.data?.length)
      toast.apiError(t('Could not refresh — showing cached data'), result.error)
  }

  useRefreshKey({ isPending: loading, refetch: refresh }, refreshKey, onLoading)
  // Polls at the caller's cadence: a view of a rate-limited API passes a slower tick. A poll joins
  // a read still in flight instead of cancelling it, so a list slower than its tick still lands.
  useSilentTick(() => {
    if (enabled) void query.refetch({ cancelRefetch: false })
  }, options.pollTick ?? 0)
  useEffect(() => {
    if (!failure) return
    const { message } = failure

    reportFrontendError({ source: 'resource_list', phase: 'load_failed', message }, failure)
  }, [failure, query.errorUpdatedAt])

  return {
    items,
    setItems,
    loading,
    revalidating: enabled && query.isFetching && !query.isPending,
    error: override?.stamp === stamp ? override.error : shownError,
    setError,
  }
}
