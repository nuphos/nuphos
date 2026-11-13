import { useState } from 'react'

import { useReportLoading } from '../../components/useReportLoading'
import { useSilentTick } from '../../hooks/useSilentRefresh'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'

// Like the rest of a workspace tab: polled while it is the active tab and the window is visible.
const TAB_POLL_MS = 5_000

/** The `refetchInterval` of a query shown in a workspace tab. */
export function useTabPollMs(): number | false {
  return useWorkspaceTab().isActive && TAB_POLL_MS
}

/** Reads a query again on the tab's refresh, reporting it as loading the way a first load is. */
export function useRefreshKey(
  query: { isPending: boolean; refetch: () => Promise<unknown> },
  refreshKey: number,
  onLoading?: (loading: boolean) => void,
): void {
  const [refreshing, setRefreshing] = useState(false)

  useSilentTick(() => {
    setRefreshing(true)
    void query.refetch().finally(() => setRefreshing(false))
  }, refreshKey)
  useReportLoading(query.isPending || refreshing, onLoading)
}
