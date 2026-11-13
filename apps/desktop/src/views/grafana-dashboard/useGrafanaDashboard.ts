import { useMemo, useState } from 'react'

import { toast } from '../../components/ui/toast'
import { ALL_VALUE, resolveTimeRange, variableQueryValue } from '../../grafana/client'
import { useSilentTick } from '../../hooks/useSilentRefresh'
import { t } from '../../i18n/index.ts'
import { useGrafanaDashboardDefinition } from '../../lib/query/grafana'
import { useResetOnKey } from '../useResetOnKey'

import { initialTimeSel } from './time'
import { useGrafanaVariableScopes } from './useGrafanaVariableScopes'

import type { TimeSel } from './time'
import type { GrafanaTarget } from '../../grafana/client'

export function useGrafanaDashboard(target: GrafanaTarget, uid: string, refreshKey: number) {
  const { data, error, refetch } = useGrafanaDashboardDefinition(target, uid)
  const dashboard = data ?? null
  // What the user picked; until then the dashboard's saved time, variables and row states apply.
  const [pickedTime, setTimeSel] = useState<TimeSel | null>(null)
  // Selected option values per variable (multi-select variables carry several;
  // `$__all` means "All").
  const [pickedSel, setSel] = useState<Record<string, string[]>>({})
  // Friendly display texts matching `sel` — used in row/panel titles.
  const [pickedTexts, setSelTexts] = useState<Record<string, string[]>>({})
  // Row panel id → expanded.
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({})

  useResetOnKey(`${target.teamId}|${target.instanceId}|${uid}`, () => {
    setTimeSel(null)
    setSel({})
    setSelTexts({})
    setOpenRows({})
  })

  // Toolbar Refresh re-reads the definition, so structural edits show up, and moves relative "now".
  useSilentTick(() => {
    void refetch().then((r) => {
      // The user asked for this refresh, so its failure is worth reporting.
      if (r.error) toast.apiError(t('Failed to refresh dashboard'), r.error)
    })
  }, refreshKey)

  const timeSel = useMemo(
    () =>
      pickedTime ??
      (dashboard
        ? initialTimeSel(dashboard.time.from, dashboard.time.to)
        : { kind: 'relative' as const, from: 'now-1h' }),
    [pickedTime, dashboard],
  )
  const sel = useMemo(
    () => ({
      ...Object.fromEntries((dashboard?.variables ?? []).map((v) => [v.name, v.currentValues])),
      ...pickedSel,
    }),
    [dashboard, pickedSel],
  )
  const selTexts = useMemo(
    () => ({
      ...Object.fromEntries((dashboard?.variables ?? []).map((v) => [v.name, v.currentTexts])),
      ...pickedTexts,
    }),
    [dashboard, pickedTexts],
  )

  const range = useMemo(() => {
    if (timeSel.kind === 'absolute') return { from: timeSel.from, to: timeSel.to }

    return resolveTimeRange(timeSel.from, 'now')
    // refreshKey advances "now" for relative ranges.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeSel, refreshKey])

  // Values substituted into queries (multi variables expand to a regex
  // alternation) and friendly texts for titles.
  const vars = useMemo(() => {
    const out: Record<string, string> = {}

    for (const v of dashboard?.variables ?? []) {
      out[v.name] = variableQueryValue(v, sel[v.name] ?? [])
    }

    return out
  }, [dashboard, sel])
  const varTexts = useMemo(() => {
    const out: Record<string, string> = {}

    for (const v of dashboard?.variables ?? []) {
      const values = sel[v.name] ?? []
      const texts = selTexts[v.name] ?? []

      out[v.name] = values.includes(ALL_VALUE) ? 'All' : texts.join(' + ') || values.join(' + ')
    }

    return out
  }, [dashboard, sel, selTexts])
  const { datasourceVariables: datasourceVars, repeatValues } = useGrafanaVariableScopes(
    target,
    dashboard,
    sel,
    selTexts,
  )

  return {
    dashboard,
    // A failed poll or refresh keeps the dashboard on screen.
    loadError: dashboard ? null : (error?.message ?? null),
    timeSel,
    setTimeSel,
    range,
    vars,
    datasourceVars,
    repeatValues,
    varTexts,
    sel,
    setSel,
    setSelTexts,
    openRows,
    setOpenRows,
  }
}
