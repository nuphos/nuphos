import { useCallback, useEffect, useState } from 'react'

import { useReportLoading } from '../components/useReportLoading'
import { useRequiredKubeContext } from '../hooks/useKubeContext'
import { useSilentRefresh } from '../hooks/useSilentRefresh'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { readSwrCache, writeSwrCache } from '../lib/swrCache'

import { AbnormalUsagePanel, OverviewCardView, SkeletonCard } from './cluster/overviewCards'
import { loadOverviewCore, loadOverviewExtras } from './cluster/overviewLoad'
import {
  RecentRestartsPanel,
  RecentWarningsPanel,
  ResourceUsagePanel,
  SkeletonResourcePanel,
} from './cluster/overviewPanels'
import { DEFAULT_ABNORMAL_THRESHOLD } from './cluster/overviewTypes'

import type { OverviewCore, OverviewExtras } from './cluster/overviewTypes'

type Props = {
  refreshKey: number
  onLoading?: (loading: boolean) => void
  // Navigate to a nav key, optionally pre-filling the list filter.
  onNavigate?: (navKey: string, filter?: string) => void
}

export function ClusterOverview({ refreshKey, onLoading, onNavigate }: Props) {
  const context = useRequiredKubeContext()
  const { pollTick } = useWorkspaceTab()
  const [core, setCore] = useState<OverviewCore | null>(null)
  const [extras, setExtras] = useState<OverviewExtras | null>(null)
  const [abnormalThreshold, setAbnormalThreshold] = useState(DEFAULT_ABNORMAL_THRESHOLD)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // The (context, refreshKey) pair the first-paint effect below last loaded
  // for. Held in state, not a ref, so the pre-fetch reset runs during this
  // render instead of committing a frame of the previous cluster's data first.
  // It also distinguishes a user-initiated refresh (refreshKey bump) from a
  // mount or a context switch.
  const [lastLoad, setLastLoad] = useState({ context, refreshKey })

  if (lastLoad.context !== context || lastLoad.refreshKey !== refreshKey) {
    const manualRefresh = lastLoad.refreshKey !== refreshKey
    const cached = readSwrCache<OverviewCore>(`overview-core:${context}`)

    setLastLoad({ context, refreshKey })
    setCore(cached ?? null)
    setExtras(readSwrCache<OverviewExtras>(`overview-extras:${context}`) ?? null)
    // A manual refresh keeps the cached snapshot on screen but reports
    // loading so the toolbar refresh icon spins until the reload lands.
    setLoading(cached === undefined || manualRefresh)
    setError(null)
  }
  useReportLoading(loading, onLoading)

  const loadCore = useCallback(() => loadOverviewCore(context), [context])
  const loadExtras = useCallback(() => loadOverviewExtras(context), [context])

  // First paint per context/refresh: stale-while-revalidate. A cached
  // snapshot renders immediately (no skeletons) while both loads refresh in
  // the background; with a cache in hand, a failed refresh degrades to a
  // console warning instead of replacing visible data with an error page.
  useEffect(() => {
    let cancelled = false
    const coreKey = `overview-core:${context}`
    const extrasKey = `overview-extras:${context}`
    const cachedCore = readSwrCache<OverviewCore>(coreKey)

    loadCore()
      .then((next) => {
        if (cancelled) return
        writeSwrCache(coreKey, next)
        setCore(next)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        if (cachedCore) {
          console.warn('[overview] refresh failed; keeping cached data:', String(e))
        } else {
          setError(String(e))
        }
        setLoading(false)
      })
    loadExtras()
      .then((next) => {
        if (cancelled) return
        writeSwrCache(extrasKey, next)
        setExtras(next)
      })
      .catch((e: unknown) => {
        // loadExtras settles its requests internally, so this only fires on
        // an unexpected throw — log it rather than leak an unhandled
        // rejection; the panels degrade to "Unavailable" on their own.
        if (!cancelled) console.warn('[overview] extras load failed:', String(e))
      })

    return () => {
      cancelled = true
    }
  }, [refreshKey, context, loadCore, loadExtras])

  // A successful background poll refreshes the data and clears any prior error.
  // A *failed* background poll is intentionally swallowed: a transient blip must
  // not replace what the user is already looking at with an error page. Only the
  // first-paint load (the effect above) surfaces errors.
  useSilentRefresh(
    loadCore,
    pollTick,
    (next) => {
      writeSwrCache(`overview-core:${context}`, next)
      setCore(next)
      setError(null)
    },
    (message) => {
      console.warn('[overview] background refresh failed; keeping current data:', message)
    },
    context,
  )
  useSilentRefresh(
    loadExtras,
    pollTick,
    (next) => {
      writeSwrCache(`overview-extras:${context}`, next)
      setExtras(next)
    },
    (message) => {
      console.warn('[overview] background refresh failed; keeping current data:', message)
    },
    context,
  )

  if (error) {
    return <div className="p-8 text-error text-[13px]">{error}</div>
  }

  return (
    <div className="p-6 overflow-auto scrollbar-thin">
      <h2 className="text-[15px] font-semibold mb-4 text-main">Cluster Overview</h2>
      <div className="grid grid-cols-2 @lg:grid-cols-3 @3xl:grid-cols-4 gap-3">
        {core === null
          ? // Match the 12 real cards so the grid doesn't reflow when data lands.
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => <SkeletonCard key={n} />)
          : core.cards.map((card) => (
              <OverviewCardView key={card.key} card={card} onNavigate={onNavigate} />
            ))}
      </div>

      {core === null ? (
        <SkeletonResourcePanel />
      ) : (
        core.resources && <ResourceUsagePanel resources={core.resources} />
      )}

      <AbnormalUsagePanel
        loading={extras === null}
        rows={extras?.abnormal ?? null}
        threshold={abnormalThreshold}
        onThresholdChange={setAbnormalThreshold}
        onNavigate={onNavigate}
      />

      <div className="mt-3 grid grid-cols-1 @3xl:grid-cols-2 gap-3">
        <RecentWarningsPanel loading={extras === null} warnings={extras?.warnings ?? null} />
        <RecentRestartsPanel
          loading={core === null}
          restarts={core?.restarts ?? null}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  )
}
