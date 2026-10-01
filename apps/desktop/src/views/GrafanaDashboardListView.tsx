import { LayoutDashboard } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { listDashboards } from '../grafana/client'
import { useSilentRefresh } from '../hooks/useSilentRefresh'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { useLinkOnlyRowMenu, useWorkspaceRowLink } from '../lib/workspaceRowLink'

import { useResetOnKey } from './useResetOnKey'

import type { DashboardSummary, GrafanaTarget } from '../grafana/client'

type Props = {
  target: GrafanaTarget
  filter?: string
  onSelect: (item: DashboardSummary) => void
  onCount?: (n: number) => void
}

export function GrafanaDashboardListView({ target, filter, onSelect, onCount }: Props) {
  const [items, setItems] = useState<DashboardSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useResetOnKey(`${target.teamId}|${target.instanceId}`, () => {
    setItems(null)
    setError(null)
  })

  useEffect(() => {
    let cancelled = false

    listDashboards(target)
      .then((rows) => {
        if (!cancelled) setItems(rows)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e))
      })

    return () => {
      cancelled = true
    }
  }, [target.teamId, target.instanceId])

  const { pollTick } = useWorkspaceTab()

  useSilentRefresh(() => listDashboards(target), pollTick, setItems, setError)

  const effectiveFilter = (filter ?? '').trim().toLowerCase()

  const grouped = useMemo(() => {
    if (!items) return []
    const filtered = effectiveFilter
      ? items.filter(
          (d) =>
            d.title.toLowerCase().includes(effectiveFilter) ||
            (d.folderTitle ?? '').toLowerCase().includes(effectiveFilter) ||
            d.tags.some((t) => t.toLowerCase().includes(effectiveFilter)),
        )
      : items
    const map = new Map<string, DashboardSummary[]>()

    for (const d of filtered) {
      const key = d.folderTitle || 'General'
      const arr = map.get(key)

      if (arr) arr.push(d)
      else map.set(key, [d])
    }

    return Array.from(map.entries())
      .map(([folder, rows]) => ({
        folder,
        rows: rows.toSorted((a, b) => a.title.localeCompare(b.title)),
      }))
      .sort((a, b) => a.folder.localeCompare(b.folder))
  }, [items, effectiveFilter])

  const filteredCount = useMemo(() => grouped.reduce((sum, g) => sum + g.rows.length, 0), [grouped])

  useEffect(() => {
    onCount?.(filteredCount)
  }, [filteredCount, onCount])

  const { linkForRow } = useWorkspaceRowLink()
  const getRowLink = useCallback(
    (d: DashboardSummary) =>
      linkForRow({
        active: 'observability.dashboards',
        dashboardTarget: { uid: d.uid, title: d.title, folderTitle: d.folderTitle },
      }),
    [linkForRow],
  )
  const { onRowContextMenu, menu } = useLinkOnlyRowMenu(getRowLink)

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-error text-[12.5px] max-w-lg text-center whitespace-pre-wrap">
          {error}
        </div>
      </div>
    )
  }

  if (!items) {
    return (
      <div className="flex-1 flex items-center justify-center text-tertiary text-[12.5px]">
        Loading dashboards…
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {menu}
      <div className="flex-1 overflow-auto scrollbar-thin">
        {grouped.length === 0 && (
          <div className="text-tertiary text-[12.5px] text-center pt-12">
            No dashboards match "{effectiveFilter}"
          </div>
        )}
        {grouped.map((g) => (
          <section key={g.folder}>
            <div className="px-6 py-2 text-[11.5px] uppercase tracking-wider text-tertiary border-b border-t border-zGray-800/60 bg-zGray-950/40 first:border-t-0">
              {g.folder}
            </div>
            <div>
              {g.rows.map((d) => (
                <button
                  key={d.uid}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return
                    onSelect(d)
                  }}
                  onClick={(e) => {
                    // Keyboard only — pointer presses already fired at pointerdown.
                    if (e.detail !== 0) return
                    onSelect(d)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    onRowContextMenu(d, e)
                  }}
                  className="w-full text-left flex items-center gap-3 px-6 py-2.5 border-b border-zGray-800/40 hover:bg-zGray-850 transition-colors"
                >
                  <LayoutDashboard
                    className="w-4 h-4 text-zViolet-accent flex-shrink-0"
                    strokeWidth={1.8}
                  />
                  <div className="text-[13px] text-main truncate flex-1 min-w-0">{d.title}</div>
                  {d.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 flex-shrink-0">
                      {d.tags.slice(0, 4).map((t) => (
                        <span
                          key={t}
                          className="px-1.5 py-px text-[10.5px] rounded bg-zGray-800/60 text-tertiary"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
