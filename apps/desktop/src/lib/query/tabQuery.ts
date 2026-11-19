import { useState } from 'react'

import { toast } from '../../components/ui/toast'
import { useReportLoading } from '../../components/useReportLoading'
import { useSilentTick } from '../../hooks/useSilentRefresh'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'

// Like the rest of a workspace tab: polled while it is the active tab and the window is visible.
const TAB_POLL_MS = 5_000

/** The `refetchInterval` of a query shown in a workspace tab. */
export function useTabPollMs(): number | false {
  return useWorkspaceTab().isActive && TAB_POLL_MS
}

/** Reads a query again on the tab's refresh, reporting it as loading the way a first load is. A
 *  view that keeps showing its last rows passes `failure`, so a failed refresh still says so. */
export function useRefreshKey(
  query: { isPending: boolean; refetch: () => Promise<{ error: Error | null }> },
  refreshKey: number,
  onLoading?: (loading: boolean) => void,
  failure?: string,
): void {
  const [refreshing, setRefreshing] = useState(false)

  useSilentTick(() => {
    setRefreshing(true)
    void query.refetch().then(({ error }) => {
      setRefreshing(false)
      if (error && failure) toast.apiError(failure, error)
    })
  }, refreshKey)
  useReportLoading(query.isPending || refreshing, onLoading)
}
