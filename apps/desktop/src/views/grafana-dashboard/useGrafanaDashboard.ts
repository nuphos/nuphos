import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { toast } from '../../components/ui/toast'
import { ALL_VALUE, getDashboard, resolveTimeRange, variableQueryValue } from '../../grafana/client'
import { useSilentRefresh, useSilentTick } from '../../hooks/useSilentRefresh'
import { useResetOnKey } from '../useResetOnKey'

import { initialTimeSel } from './time'
import { useGrafanaVariableScopes } from './useGrafanaVariableScopes'

import type { TimeSel } from './time'
import type { GrafanaTarget } from '../../grafana/client'
import type { Dashboard } from '../../grafana/types'

export function useGrafanaDashboard(
  target: GrafanaTarget,
  uid: string,
  refreshKey: number,
  pollTick: number,
) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [timeSel, setTimeSel] = useState<TimeSel>({ kind: 'relative', from: 'now-1h' })
  const [refreshTick, setRefreshTick] = useState(0)
  // Selected option values per variable (multi-select variables carry several;
  // `$__all` means "All").
  const [sel, setSel] = useState<Record<string, string[]>>({})
  // Friendly display texts matching `sel` — used in row/panel titles.
  const [selTexts, setSelTexts] = useState<Record<string, string[]>>({})
  // Row panel id → expanded. Seeded from the dashboard's saved collapsed state.
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({})

  // Only successful completions advance the request commit watermark.
  const defRequestRef = useRef(0)
  const defCommittedRef = useRef(0)

  useResetOnKey(`${target.teamId}|${target.instanceId}|${uid}`, () => {
    setDashboard(null)
    setLoadError(null)
    setSel({})
    setSelTexts({})
  })

  useEffect(() => {
    let cancelled = false
    const request = ++defRequestRef.current

    getDashboard(target, uid)
      .then((d) => {
        if (cancelled || request <= defCommittedRef.current) return
        defCommittedRef.current = request
        const initVal: Record<string, string[]> = {}
        const initText: Record<string, string[]> = {}

        for (const v of d.variables) {
          initVal[v.name] = v.currentValues
          initText[v.name] = v.currentTexts
        }
        const rows: Record<string, boolean> = {}

        for (const p of d.panels) {
          if (p.type === 'row') rows[String(p.id)] = !p.collapsed
        }
        // Commit substitutions with the dashboard before panels query.
        setSel(initVal)
        setSelTexts(initText)
        setTimeSel(initialTimeSel(d.time.from, d.time.to))
        setOpenRows(rows)
        setDashboard(d)
      })
      .catch((e: unknown) => {
        // Do not let an older failure replace a newer committed dashboard.
        if (!cancelled && request > defCommittedRef.current) {
          setLoadError(String(e instanceof Error ? e.message : e))
        }
      })

    return () => {
      cancelled = true
    }
  }, [target.teamId, target.instanceId, uid])

  // Commit a re-fetched dashboard definition without resetting the user's
  // current variable selections / time range / open rows: only new rows and
  // variables get seeded, existing selections stay untouched.
  const mergeDashboard = useCallback((d: Dashboard) => {
    setOpenRows((prev) => {
      const next = { ...prev }

      for (const p of d.panels) {
        const key = String(p.id)

        if (p.type === 'row' && !(key in next)) next[key] = !p.collapsed
      }

      return next
    })
    setSel((prev) => {
      const next = { ...prev }

      for (const v of d.variables) if (!(v.name in next)) next[v.name] = v.currentValues

      return next
    })
    setSelTexts((prev) => {
      const next = { ...prev }

      for (const v of d.variables) if (!(v.name in next)) next[v.name] = v.currentTexts

      return next
    })
    setDashboard(d)
  }, [])

  // Refresh re-fetches the dashboard DEFINITION too, so structural edits
  // (panel type/layout, added/removed panels/variables) show up — previously
  // it only re-ran panel data queries, so a table→timeseries change needed a
  // full re-entry.
  const lastRefreshTickRef = useRef(0)

  useEffect(() => {
    // Act only when Refresh advanced refreshTick. A target/uid change (also a
    // dep) instead runs the cleanup below, dropping any in-flight refresh
    // whose late response would otherwise clobber the freshly-loaded dashboard —
    // it does NOT fetch here; the load effect above owns that.
    const isRefresh = refreshTick !== lastRefreshTickRef.current

    lastRefreshTickRef.current = refreshTick
    if (!isRefresh) return
    let cancelled = false
    const request = ++defRequestRef.current

    getDashboard(target, uid)
      .then((d) => {
        if (cancelled || request <= defCommittedRef.current) return
        defCommittedRef.current = request
        mergeDashboard(d)
      })
      // On a refresh error, keep showing the current dashboard rather than
      // blanking; the toast whitelist decides if the failure is user-visible.
      // The toast is not gen-gated — the user asked for this refresh, so its
      // failure is worth reporting even if a later fetch superseded it.
      .catch((e: unknown) => {
        if (!cancelled) toast.apiError('Failed to refresh dashboard', e)
      })

    return () => {
      cancelled = true
    }
  }, [refreshTick, target.teamId, target.instanceId, uid, mergeDashboard])

  // Toolbar Refresh re-fetches the definition and recomputes relative "now".
  useSilentTick(() => setRefreshTick((n) => n + 1), refreshKey)

  // Background heartbeat: silently re-fetch the definition so panels someone
  // else (e.g. the agent) just added appear on their own. Committing a
  // dashboard replaces every panel's identity and refetches all their data,
  // so only structural changes commit — an unchanged definition is a no-op
  // and the 5s poll never re-runs panel queries by itself.
  useSilentRefresh(
    // The hook re-reads these callbacks each render, so `dashboard` is
    // current. Until the initial load lands, don't fetch at all — taking a
    // generation here would invalidate the in-flight load while this commit
    // path (gated on `dashboard`) could never replace it.
    () => {
      if (!dashboard) return Promise.resolve(null)
      const request = ++defRequestRef.current

      return getDashboard(target, uid).then((d) => ({ d, request }))
    },
    pollTick,
    (res) => {
      if (!res || !dashboard || res.request <= defCommittedRef.current) return
      defCommittedRef.current = res.request
      if (JSON.stringify(res.d) === JSON.stringify(dashboard)) return
      mergeDashboard(res.d)
    },
    () => {},
    `${target.teamId}/${target.instanceId}/${uid}`,
  )

  const range = useMemo(() => {
    if (timeSel.kind === 'absolute') return { from: timeSel.from, to: timeSel.to }

    return resolveTimeRange(timeSel.from, 'now')
    // refreshTick advances "now" for relative ranges.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeSel, refreshTick])

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
    loadError,
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
