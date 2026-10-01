import { Calendar, ChevronDown, LayoutGrid, Plus } from 'lucide-react'
import { useRef, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'

import { Menu, MenuContent, MenuItem, MenuTrigger, MenuSeparator } from '../../components/ui/menu'

import { RANGE_PRESETS, rangeLabel } from './helpers'

import type {
  NuphosDashboardDetail,
  DashboardViewRange,
  DashboardPanel,
  DashboardGranularity,
  DashboardRangePreset,
} from '../schema'
import type { Dispatch, SetStateAction } from 'react'

type CustomRange = { periodStart: string; periodEnd: string } | null

type Props = {
  teamId: string
  onDefaultSaved: (id: string) => Promise<void>
  detail: NuphosDashboardDetail | null
  viewRange?: DashboardViewRange
  panels: DashboardPanel[]
  canvasView: 'panels' | 'insights'
  setCanvasView: Dispatch<SetStateAction<'panels' | 'insights'>>
  customRange: CustomRange
  setCustomRange: Dispatch<SetStateAction<CustomRange>>
  refreshing: boolean
  editingLayout: boolean
  setEditingLayout: Dispatch<SetStateAction<boolean>>
  applyDate: (
    patch:
      | { preset: DashboardRangePreset }
      | { periodStart: string; periodEnd: string; granularity: DashboardGranularity },
  ) => void
  onAddPanel: () => void
  openPanelAssistant: () => void
}

export function DashboardToolbar({
  teamId,
  onDefaultSaved,
  detail,
  viewRange,
  panels,
  canvasView,
  setCanvasView,
  customRange,
  setCustomRange,
  refreshing,
  editingLayout,
  setEditingLayout,
  applyDate,
  onAddPanel,
  openPanelAssistant,
}: Props) {
  const [savingDefault, setSavingDefault] = useState(false)
  const savingDefaultRef = useRef(false)
  const dashboard = detail
    ? {
        ...detail.dashboard,
        timeRange: detail.viewTimeRange ?? detail.dashboard.timeRange,
        rangePreset: viewRange
          ? 'preset' in viewRange
            ? viewRange.preset
            : null
          : detail.dashboard.rangePreset,
      }
    : null

  const saveDefault = async () => {
    if (!detail?.canEdit || !dashboard || savingDefaultRef.current) return
    savingDefaultRef.current = true
    setSavingDefault(true)
    try {
      await api.dashboardsUpdate(
        teamId,
        dashboard.id,
        dashboard.rangePreset
          ? { rangePreset: dashboard.rangePreset }
          : {
              timeRange: {
                ...dashboard.timeRange,
                granularity: dashboard.timeRange.granularity ?? 'day',
              },
              rangePreset: null,
            },
      )
      toast.success('Default time range saved')
      await onDefaultSaved(dashboard.id)
    } catch (err) {
      toast.apiError('Could not save default time range', err)
    } finally {
      savingDefaultRef.current = false
      setSavingDefault(false)
    }
  }

  return (
    <div className="flex h-[42px] items-center gap-2 border-b border-zGray-800/60 px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {dashboard && (
          <>
            <div className="flex h-8 shrink-0 items-center gap-0.5 rounded-md border border-zGray-800 p-0.5 text-[12.5px]">
              <button
                type="button"
                className={`rounded px-2.5 py-1 outline-none ${canvasView === 'panels' ? 'bg-zGray-800 text-main' : 'text-tertiary hover:text-main'}`}
                onClick={() => setCanvasView('panels')}
              >
                Panels
              </button>
              <button
                type="button"
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 outline-none ${canvasView === 'insights' ? 'bg-zGray-800 text-main' : 'text-tertiary hover:text-main'}`}
                onClick={() => setCanvasView('insights')}
              >
                Insights
                {panels.some(
                  (p) =>
                    p.insight?.status === 'complete' &&
                    p.insight.findings.some((f) => f.kind === 'anomaly'),
                ) && <span className="h-1.5 w-1.5 rounded-full bg-warning" />}
              </button>
            </div>
            <Menu>
              <MenuTrigger
                render={
                  <button
                    type="button"
                    className="flex h-8 items-center gap-1.5 rounded-md border border-zGray-800 bg-zGray-900 px-2.5 text-[12.5px] text-main outline-none hover:bg-zGray-800 focus:border-zViolet-500"
                  >
                    <Calendar className="h-3.5 w-3.5 text-tertiary" />
                    {dashboard.rangePreset
                      ? (RANGE_PRESETS.find((p) => p.key === dashboard.rangePreset)?.label ??
                        rangeLabel(dashboard.timeRange.periodStart, dashboard.timeRange.periodEnd))
                      : rangeLabel(dashboard.timeRange.periodStart, dashboard.timeRange.periodEnd)}
                    <ChevronDown className="h-3.5 w-3.5 text-tertiary" />
                  </button>
                }
              />
              <MenuContent align="start">
                {RANGE_PRESETS.map((p) => (
                  <MenuItem
                    key={p.key}
                    onClick={() => {
                      setCustomRange(null)
                      applyDate({ preset: p.key })
                    }}
                  >
                    {p.label}
                  </MenuItem>
                ))}
                <MenuItem
                  onClick={() =>
                    setCustomRange({
                      periodStart: dashboard.timeRange.periodStart,
                      periodEnd: dashboard.timeRange.periodEnd,
                    })
                  }
                >
                  Custom range…
                </MenuItem>
                {detail?.canEdit && (
                  <>
                    <MenuSeparator />
                    <MenuItem
                      disabled={savingDefault || Boolean(customRange)}
                      onClick={() => void saveDefault()}
                    >
                      {savingDefault ? 'Saving default…' : 'Set current range as default'}
                    </MenuItem>
                  </>
                )}
              </MenuContent>
            </Menu>
            {customRange && (
              <>
                <input
                  type="date"
                  name="dashboard-range-start"
                  aria-label="Start date"
                  autoComplete="off"
                  className="h-8 rounded-md border border-zGray-800 bg-zGray-900 px-2 text-[12.5px] text-main outline-none focus:border-zViolet-500"
                  value={customRange.periodStart.slice(0, 10)}
                  max={customRange.periodEnd.slice(0, 10)}
                  onChange={(e) => {
                    if (e.target.value)
                      setCustomRange(
                        (current) =>
                          current && {
                            ...current,
                            periodStart: `${e.target.value}T00:00:00.000Z`,
                          },
                      )
                  }}
                />
                <span className="text-[12px] text-tertiary">→</span>
                <input
                  type="date"
                  name="dashboard-range-end"
                  aria-label="End date"
                  autoComplete="off"
                  className="h-8 rounded-md border border-zGray-800 bg-zGray-900 px-2 text-[12.5px] text-main outline-none focus:border-zViolet-500"
                  value={customRange.periodEnd.slice(0, 10)}
                  min={customRange.periodStart.slice(0, 10)}
                  onChange={(e) => {
                    if (e.target.value)
                      setCustomRange(
                        (current) =>
                          current && { ...current, periodEnd: `${e.target.value}T23:59:59.999Z` },
                      )
                  }}
                />
                <button
                  type="button"
                  className="h-8 rounded-md bg-zViolet-500 px-2.5 text-[12.5px] font-medium text-white hover:bg-zViolet-400 disabled:opacity-50"
                  disabled={refreshing || customRange.periodStart > customRange.periodEnd}
                  onClick={() =>
                    applyDate({
                      ...customRange,
                      granularity: dashboard.timeRange.granularity ?? 'day',
                    })
                  }
                >
                  Apply
                </button>
              </>
            )}
          </>
        )}
      </div>
      {dashboard && (
        <div className="flex shrink-0 items-center gap-2">
          {canvasView === 'panels' && (
            <button
              type="button"
              className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] outline-none ${editingLayout ? 'border-zViolet-500/50 bg-zViolet-500/10 text-zViolet-accent' : 'border-zGray-800 text-secondary hover:bg-zGray-800 hover:text-main focus:bg-zGray-800'}`}
              onClick={() => setEditingLayout((editing) => !editing)}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> {editingLayout ? 'Done' : 'Edit layout'}
            </button>
          )}
          {/* Split button: asking Agent is the default path; the dropdown
              keeps the explicit manual editor available when needed. */}
          <div className="flex items-center">
            <button
              type="button"
              className="flex h-8 items-center gap-1.5 rounded-l-md bg-zViolet-500 px-2.5 text-[13px] font-medium text-white outline-none hover:bg-zViolet-400 focus:bg-zViolet-400"
              onClick={openPanelAssistant}
            >
              <Plus className="h-3.5 w-3.5" /> Add Panel
            </button>
            <Menu>
              <MenuTrigger
                render={
                  <button
                    type="button"
                    title="More ways to add"
                    aria-label="More ways to add a panel"
                    className="flex h-8 items-center rounded-r-md border-l border-zViolet-400/60 bg-zViolet-500 px-1.5 text-white outline-none hover:bg-zViolet-400 focus:bg-zViolet-400"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                }
              />
              <MenuContent align="end">
                <MenuItem icon={<Plus className="h-3.5 w-3.5" />} onClick={onAddPanel}>
                  Add panel manually
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>
      )}
    </div>
  )
}
