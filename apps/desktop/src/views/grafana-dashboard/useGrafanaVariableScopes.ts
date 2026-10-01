import { useEffect, useMemo, useState } from 'react'

import {
  ALL_VALUE,
  listDatasources,
  parseGrafanaRegex,
  variableQueryValue,
} from '../../grafana/client'
import { useResetOnKey } from '../useResetOnKey'

import type { GrafanaTarget } from '../../grafana/client'
import type { Dashboard, RepeatValue } from '../../grafana/types'

type DatasourceOption = { value: string; text: string }

export function useGrafanaVariableScopes(
  target: GrafanaTarget,
  dashboard: Dashboard | null,
  selected: Record<string, string[]>,
  selectedTexts: Record<string, string[]>,
) {
  const options = useDatasourceOptions(target, dashboard)
  const datasourceVariables = useMemo(() => {
    const out: Record<string, string[]> = {}

    for (const variable of dashboard?.variables ?? []) {
      if (variable.type !== 'datasource') continue
      const values = selected[variable.name] ?? []

      out[variable.name] =
        values.length === 0 || values.includes(ALL_VALUE)
          ? (options[variable.name] ?? []).map((option) => option.value)
          : values
    }

    return out
  }, [dashboard, options, selected])
  const repeatValues = useMemo(() => {
    const out: Record<string, RepeatValue[]> = {}

    for (const variable of dashboard?.variables ?? []) {
      const values = selected[variable.name] ?? []
      const texts = selectedTexts[variable.name] ?? []
      const variableOptions = options[variable.name]
      const isAll = values.length === 0 || values.includes(ALL_VALUE)

      // Datasource All expands after concrete options load. Query-variable
      // All remains unscoped until its option loader is shared with this hook.
      if (isAll && variable.type !== 'datasource') continue
      const repeated = isAll ? (variableOptions ?? []).map((option) => option.value) : values

      out[variable.name] = repeated.map((value, index) => ({
        value,
        text:
          variableOptions?.find((option) => option.value === value)?.text ?? texts[index] ?? value,
        queryValue: variableQueryValue(variable, [value]),
      }))
    }

    return out
  }, [dashboard, options, selected, selectedTexts])

  return { datasourceVariables, repeatValues }
}

function useDatasourceOptions(target: GrafanaTarget, dashboard: Dashboard | null) {
  const [options, setOptions] = useState<Record<string, DatasourceOption[]>>({})
  const variables = useMemo(
    () => dashboard?.variables.filter((variable) => variable.type === 'datasource') ?? [],
    [dashboard],
  )
  const optionsKey = `${target.teamId}|${target.instanceId}|${JSON.stringify(variables)}`

  useResetOnKey(optionsKey, () => setOptions({}))

  useEffect(() => {
    let cancelled = false

    if (variables.length === 0) return
    void listDatasources(target)
      .then((all) => {
        if (cancelled) return
        const next: Record<string, DatasourceOption[]> = {}

        for (const variable of variables) {
          const nameRegex = parseGrafanaRegex(variable.datasourceNameRegex)

          next[variable.name] = all
            .filter((datasource) => {
              if (nameRegex) nameRegex.lastIndex = 0

              return (
                (!variable.datasourceTypeFilter ||
                  datasource.type === variable.datasourceTypeFilter) &&
                (!nameRegex || nameRegex.test(datasource.name))
              )
            })
            .map((datasource) => ({ value: datasource.uid, text: datasource.name }))
        }
        setOptions(next)
      })
      .catch(() => {
        // Concrete saved selections still work; All waits for options.
      })

    return () => {
      cancelled = true
    }
  }, [target, variables])

  return options
}
