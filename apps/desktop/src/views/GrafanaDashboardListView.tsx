import { LayoutDashboard } from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'

import { t } from '../i18n'
import { useGrafanaDashboards } from '../lib/query/grafana'
import { useLinkOnlyRowMenu, useWorkspaceRowLink } from '../lib/workspaceRowLink'

import type { DashboardSummary, GrafanaTarget } from '../grafana/client'

type Props = {
  target: GrafanaTarget
  filter?: string
  onSelect: (item: DashboardSummary) => void
  onCount?: (n: number) => void
}

export function GrafanaDashboardListView({ target, filter, onSelect, onCount }: Props) {
  const { data: items, error } = useGrafanaDashboards(target)

  const effectiveFilter = (filter ?? '').trim().toLowerCase()

  const grouped = useMemo(() => {
    if (!items) return []
    const filtered = effectiveFilter
      ? items.filter(
          (d) =>
            d.title.toLowerCase().includes(effectiveFilter) ||
            (d.folderTitle ?? '').toLowerCase().includes(effectiveFilter) ||
            d.tags.some((tag) => tag.toLowerCase().includes(effectiveFilter)),
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

  if (!items && error) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-error text-[12.5px] max-w-lg text-center whitespace-pre-wrap">
          {error.message}
        </div>
      </div>
    )
  }

  if (!items) {
    return (
      <div className="flex-1 flex items-center justify-center text-tertiary text-[12.5px]">
        {t('Loading dashboards…')}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {menu}
      {/* Folders are quiet group titles and rows are 36px with no dividers, like the sidebar. */}
      <div className="flex-1 overflow-auto scrollbar-thin px-3 pb-4">
        {grouped.length === 0 && (
          <div className="text-tertiary text-[12.5px] text-center pt-12">
            {t('No dashboards match "{filter}"', { filter: effectiveFilter })}
          </div>
        )}
        {grouped.map((g) => (
          <section key={g.folder}>
            <div className="px-3 pt-5 pb-1.5 text-[12.5px] font-medium text-tertiary">
              {g.folder}
            </div>
            <div className="space-y-1">
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
                  className="flex h-9 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left transition-colors hover:bg-state-hover focus-visible:bg-state-hover"
                >
                  <LayoutDashboard
                    className="w-4 h-4 text-tertiary flex-shrink-0"
                    strokeWidth={1.8}
                  />
                  <div className="text-[13px] text-main truncate flex-1 min-w-0">{d.title}</div>
                  {d.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 flex-shrink-0">
                      {d.tags.slice(0, 4).map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-px text-[10.5px] rounded bg-state-selected text-tertiary"
                        >
                          {tag}
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
