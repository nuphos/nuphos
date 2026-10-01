import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/menu'
import { toast } from '../../components/ui/toast'
import {
  ALL_VALUE,
  listDatasources,
  parseGrafanaRegex,
  queryVariableOptions,
  substituteVars,
} from '../../grafana/client'
import { reconcileVariableSelection } from '../../grafana/variableSelection'
import { useResetOnKey } from '../useResetOnKey'

import type { GrafanaTarget } from '../../grafana/client'
import type { Variable } from '../../grafana/types'

export function VariablePicker({
  target,
  variable,
  selected,
  displayText,
  vars,
  range,
  onChange,
}: {
  target: GrafanaTarget
  variable: Variable
  selected: string[]
  displayText: string
  vars: Record<string, string>
  range: { from: number; to: number }
  onChange: (nextValues: string[], nextTexts: string[]) => void
}) {
  const [options, setOptions] = useState<{ value: string; label: string }[] | null>(null)
  const pickable = variable.type === 'datasource' || variable.type === 'query'
  // Read fresh in async handlers — the options effect is keyed on the query,
  // not on the selection.
  const selectedRef = useRef(selected)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    selectedRef.current = selected
    onChangeRef.current = onChange
  })

  useEffect(() => {
    if (variable.type !== 'datasource') return
    let cancelled = false

    listDatasources(target)
      .then((all) => {
        if (cancelled) return
        const typeFilter = variable.datasourceTypeFilter
        const nameRe = parseGrafanaRegex(variable.datasourceNameRegex)
        const filtered = all
          .filter((d) => !typeFilter || d.type === typeFilter)
          .filter((d) => !nameRe || nameRe.test(d.name))
        const opts = filtered.map((d) => ({ value: d.uid, label: d.name }))

        setOptions(variable.includeAll ? [{ value: ALL_VALUE, label: 'All' }, ...opts] : opts)
        const values = filtered.map((datasource) => datasource.uid)
        const next = reconcileVariableSelection(
          selectedRef.current,
          values,
          variable.includeAll === true,
        )

        if (next) {
          onChangeRef.current(
            next,
            next.map((value) =>
              value === ALL_VALUE
                ? 'All'
                : (filtered.find((datasource) => datasource.uid === value)?.name ?? value),
            ),
          )
        }
      })
      .catch(() => setOptions([]))

    return () => {
      cancelled = true
    }
  }, [target.teamId, target.instanceId, variable])

  // Query-variable options load eagerly (not on first open) and reload when
  // the variables their query interpolates change (e.g. the service list is
  // filtered by $env) — keyed on the substituted query text.
  const queryKey =
    variable.type === 'query'
      ? `${substituteVars(variable.datasource?.uid ?? '', vars)}|${substituteVars(variable.query ?? '', vars)}`
      : ''

  useResetOnKey(`${variable.name}|${queryKey}|${target.teamId}|${target.instanceId}`, () => {
    if (variable.type === 'query') setOptions(null)
  })
  useEffect(() => {
    if (variable.type !== 'query') return
    let cancelled = false

    // Deliberately NOT keyed on the time range: these variables refresh "on
    // dashboard load" (Grafana refresh: 1), and re-running on every refresh
    // tick would flash the pickers. The fetch uses the range current at the
    // time the query inputs change.
    queryVariableOptions(target, variable, vars, range)
      .then((values) => {
        if (cancelled) return
        const opts = values.map((v) => ({ value: v, label: v }))

        setOptions(variable.includeAll ? [{ value: ALL_VALUE, label: 'All' }, ...opts] : opts)
        // A parent-variable change can invalidate the current selection —
        // drop values missing from the reloaded options, falling back to All
        // (or the first option) when nothing survives.
        const cur = selectedRef.current
        const next = reconcileVariableSelection(cur, values, variable.includeAll === true)

        if (!next) return
        if (next.length > 0) {
          onChangeRef.current(
            next,
            next.map((v) => (v === ALL_VALUE ? 'All' : v)),
          )
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return
        toast.apiError('Failed to load variable options', e)
        setOptions([])
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, variable, target.teamId, target.instanceId])

  const label = variable.label || variable.name

  if (!pickable) {
    return (
      <div className="px-2 py-1 rounded-md bg-zGray-900 border border-zGray-800 text-[11.5px] text-tertiary">
        <span className="text-tertiary">{label}:</span>{' '}
        <span className="text-secondary">{displayText || '—'}</span>
      </div>
    )
  }

  const pick = (o: { value: string; label: string }) => {
    if (variable.multi) {
      if (o.value === ALL_VALUE) {
        onChange([ALL_VALUE], ['All'])

        return
      }
      const withoutAll = selected.filter((v) => v !== ALL_VALUE)
      const texts = (selected.includes(ALL_VALUE) ? [] : withoutAll).map(
        (v) => options?.find((x) => x.value === v)?.label ?? v,
      )
      const base = selected.includes(ALL_VALUE) ? [] : withoutAll
      const idx = base.indexOf(o.value)
      let nextValues: string[]
      let nextTexts: string[]

      if (idx >= 0) {
        nextValues = base.filter((v) => v !== o.value)
        nextTexts = texts.filter((_, i) => i !== idx)
        if (nextValues.length === 0 && variable.includeAll) {
          nextValues = [ALL_VALUE]
          nextTexts = ['All']
        }
      } else {
        nextValues = [...base, o.value]
        nextTexts = [...texts, o.label]
      }
      if (nextValues.length > 0) onChange(nextValues, nextTexts)
    } else {
      onChange([o.value], [o.label])
    }
  }

  return (
    <Menu>
      <MenuTrigger className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zGray-900 border border-zGray-800 hover:bg-zGray-800 text-[11.5px]">
        <span className="text-tertiary">{label}:</span>
        <span className="text-main max-w-[160px] truncate">{displayText || '—'}</span>
        <ChevronDown className="w-3 h-3 text-tertiary" strokeWidth={1.8} />
      </MenuTrigger>
      <MenuContent align="end">
        {options === null && (
          <div className="px-2.5 py-1.5 text-[12px] text-tertiary">Loading…</div>
        )}
        {options?.length === 0 && (
          <div className="px-2.5 py-1.5 text-[12px] text-tertiary">No matches</div>
        )}
        {options?.map((o) => (
          <MenuItem
            key={o.value}
            selected={selected.includes(o.value)}
            closeOnClick={!variable.multi}
            onClick={() => pick(o)}
          >
            {o.label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}
