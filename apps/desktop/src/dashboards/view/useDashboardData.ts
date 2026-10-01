import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'

import type { DashboardViewRange, NuphosDashboard, NuphosDashboardDetail } from '../schema'

type Args = {
  teamId: string
  viewRange?: DashboardViewRange
  refreshKey: number
  selectedId: string | null
  onCount?: (n: number) => void
  onLoading?: (loading: boolean) => void
  onDashboardOpened?: (
    d: { dashboardId: string; dashboardName: string; viewRange?: DashboardViewRange } | null,
  ) => void
  onDashboardsChange?: (dashboards: { id: string; name: string }[]) => void
}

export function useDashboardData({
  teamId,
  viewRange,
  refreshKey,
  selectedId,
  onCount,
  onLoading,
  onDashboardOpened,
  onDashboardsChange,
}: Args) {
  const [dashboards, setDashboards] = useState<NuphosDashboard[]>([])
  const [detail, setDetail] = useState<NuphosDashboardDetail | null>(null)
  const [detailError, setDetailError] = useState(false)
  const [loading, setLoading] = useState(false)
  const loadSeq = useRef(0)
  const viewKey = JSON.stringify([teamId, selectedId, viewRange])
  const viewKeyRef = useRef(viewKey)

  useEffect(() => {
    viewKeyRef.current = viewKey
  }, [viewKey])
  // The open dashboard lives on the workspace tab (breadcrumb + URL own it);
  // null renders the dashboard list page. Async guards compare against this
  // ref, synchronized after each selection change rather than during render.
  const selectedIdRef = useRef<string | null>(selectedId)

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])
  // Gates list reporting until the first load settles, so a stale cache from a
  // previous mount isn't clobbered by the initial empty state.
  const listLoadedRef = useRef(false)

  const setLoad = useCallback(
    (v: boolean) => {
      setLoading(v)
      onLoading?.(v)
    },
    [onLoading],
  )

  // Load dashboards for the team — the list page's rows and the breadcrumb
  // switcher's options. Loading is only surfaced while the list page shows.
  useEffect(() => {
    let cancelled = false
    const listOwnsLoading = selectedIdRef.current === null

    if (listOwnsLoading) setLoad(true)
    api
      .dashboardsList(teamId)
      .then((list) => {
        if (cancelled) return
        listLoadedRef.current = true
        setDashboards(list)
      })
      .catch((err: unknown) => !cancelled && toast.apiError('Could not load dashboards', err))
      .finally(() => {
        if (!cancelled && listOwnsLoading && selectedIdRef.current === null) setLoad(false)
      })

    return () => {
      cancelled = true
    }
  }, [teamId, refreshKey, setLoad])

  // Refine a deep-linked placeholder name once the list knows the open
  // dashboard. Never closes it — an id the list doesn't know yet (a
  // toolbar-driven create pending its refresh) is left alone.
  useEffect(() => {
    if (!onDashboardOpened || !selectedId) return
    const d = dashboards.find((dashboard) => dashboard.id === selectedId)

    if (d) onDashboardOpened({ dashboardId: d.id, dashboardName: d.name, viewRange })
  }, [dashboards, selectedId, onDashboardOpened, viewRange])

  // Publish the list so the breadcrumb switcher has options without owning any
  // loading of its own.
  useEffect(() => {
    if (!onDashboardsChange || !listLoadedRef.current) return
    onDashboardsChange(dashboards.map((d) => ({ id: d.id, name: d.name })))
  }, [dashboards, onDashboardsChange])

  // Load the selected dashboard's detail (dashboard + panels + snapshots).
  // `silent` polls without flipping the global loading state or toasting.
  const loadDetail = useCallback(
    async (id: string, opts?: { silent?: boolean }) => {
      // A stale action must not invalidate, start, or apply a load for a
      // dashboard that is no longer intended to be selected.
      if (selectedIdRef.current !== id || viewKeyRef.current !== viewKey) return

      // Discard a slow response if a newer load (dashboard switch, date change,
      // poll) started after it, so an earlier request can't clobber fresher data.
      const seq = ++loadSeq.current

      if (!opts?.silent) {
        setDetailError(false)
        setLoad(true)
      }
      try {
        let d = await api.dashboardsGet(teamId, id, viewRange)

        if (seq !== loadSeq.current || viewKeyRef.current !== viewKey) return
        if (!opts?.silent && viewRange && d.panels.some((p) => !p.currentSnapshot)) {
          await api.dashboardsRefresh(teamId, id, false, viewRange)
          d = await api.dashboardsGet(teamId, id, viewRange)
        }

        if (
          seq !== loadSeq.current ||
          selectedIdRef.current !== id ||
          viewKeyRef.current !== viewKey
        )
          return
        setDetail(d)
        setDetailError(false)
        onCount?.(d.panels.length)
      } catch (err) {
        if (
          seq === loadSeq.current &&
          selectedIdRef.current === id &&
          viewKeyRef.current === viewKey &&
          !opts?.silent
        ) {
          toast.apiError('Could not load dashboard', err)
          setDetailError(true)
        }
      } finally {
        if (
          seq === loadSeq.current &&
          selectedIdRef.current === id &&
          viewKeyRef.current === viewKey &&
          !opts?.silent
        )
          setLoad(false)
      }
    },
    [teamId, onCount, setLoad, viewRange, viewKey],
  )

  // Invalidate in-flight loads, then fetch the newly opened dashboard.
  useEffect(() => {
    loadSeq.current += 1
    if (!selectedId) {
      // Back to the list: a cancelled detail load can no longer clear the
      // global loading flag, and the list is already cached.
      if (listLoadedRef.current) setLoad(false)

      return
    }
    // `loadDetail` raises the loading flag before it awaits, so starting it
    // straight from the effect body would cascade a second render inside the
    // same commit. Kick it off once the commit has drained instead.
    let cancelled = false

    queueMicrotask(() => {
      if (!cancelled) {
        setDetail(null)
        void loadDetail(selectedId)
      }
    })

    return () => {
      cancelled = true
    }
  }, [selectedId, loadDetail, setLoad])

  // Panel scripts run asynchronously on an agent runtime. Poll while any panel is
  // still running or an explicitly requested insight is pending.
  useEffect(() => {
    if (!detail || !selectedId) return
    const anyRunning = detail.panels.some((p) => p.currentSnapshot?.status === 'running')
    const awaitingInsight = detail.panels.some((p) => {
      // An insight generating asynchronously — keep polling until it settles.
      if (p.insight?.status === 'pending') return true
      const s = p.currentSnapshot

      if (s?.status !== 'complete' || p.insight) return false
      const settledAt = new Date(s.finishedAt ?? s.createdAt).getTime()

      return Date.now() - settledAt < 20_000
    })

    if (!anyRunning && !awaitingInsight) return
    const t = setTimeout(() => {
      void loadDetail(selectedId, { silent: true })
    }, 2_500)

    return () => clearTimeout(t)
  }, [detail, selectedId, loadDetail])

  return {
    dashboards,
    setDashboards,
    detail,
    setDetail,
    detailError,
    setDetailError,
    loading,
    loadDetail,
  }
}
